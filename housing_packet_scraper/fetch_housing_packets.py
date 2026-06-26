#!/usr/bin/env python3
"""Fetch "Housing Case Packet" emails from Gmail and download the court
decisions linked inside them as PDFs into a local folder.

What it does
------------
1. Logs into your Gmail over IMAP (read-only) using an App Password.
2. Finds every email whose subject contains "housing case packet".
3. Parses each email for links and sorts them into:
     - Official NY court decisions on nycourts.gov  -> downloaded as PDF
     - NYSCEF documents (login-walled / anti-scraping) -> NOT downloaded,
       instead written to a CSV so you can grab them by hand
     - Statutes / other reference links             -> ignored
4. Saves one sub-folder per weekly packet, e.g.
     <output>/2026-02-24 - Housing Case Packet/<Case Name>.pdf

It never deletes anything and is safe to re-run: files that already exist
are skipped.

See README.md for setup. Quick start:
    pip install -r requirements.txt
    python fetch_housing_packets.py        # uses config.ini / prompts you
"""

from __future__ import annotations

import argparse
import configparser
import csv
import email
import email.header
import email.utils
import getpass
import imaplib
import os
import re
import sys
from datetime import datetime
from email.message import Message
from pathlib import Path
from urllib.parse import urljoin, urlparse

try:
    import requests
except ImportError:  # pragma: no cover - guidance for the user
    sys.exit("Missing dependency 'requests'. Run:  pip install -r requirements.txt")

try:
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover
    sys.exit("Missing dependency 'beautifulsoup4'. Run:  pip install -r requirements.txt")

# xhtml2pdf is only needed to turn .htm decision pages into PDFs. We import it
# lazily so the rest of the tool still works if it isn't installed.
IMAP_HOST = "imap.gmail.com"
DEFAULT_MAILBOX = "[Gmail]/All Mail"
DEFAULT_SUBJECT = "housing case packet"

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

MONTHS = {
    m.lower(): i
    for i, m in enumerate(
        [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ],
        start=1,
    )
}


# --------------------------------------------------------------------------- #
# Config / credentials
# --------------------------------------------------------------------------- #
def load_config(config_path: Path) -> dict:
    """Read credentials and settings from config.ini, env vars, then prompt."""
    cfg = {"email": "", "app_password": "", "output_dir": "", "mailbox": "", "subject": ""}

    if config_path.exists():
        parser = configparser.ConfigParser()
        parser.read(config_path)
        if parser.has_section("gmail"):
            cfg["email"] = parser.get("gmail", "email", fallback="").strip()
            cfg["app_password"] = parser.get("gmail", "app_password", fallback="").strip()
        if parser.has_section("settings"):
            cfg["output_dir"] = parser.get("settings", "output_dir", fallback="").strip()
            cfg["mailbox"] = parser.get("settings", "mailbox", fallback="").strip()
            cfg["subject"] = parser.get("settings", "subject", fallback="").strip()

    # Environment variables override the file.
    cfg["email"] = os.environ.get("GMAIL_ADDRESS", cfg["email"])
    cfg["app_password"] = os.environ.get("GMAIL_APP_PASSWORD", cfg["app_password"])

    if not cfg["email"]:
        cfg["email"] = input("Gmail address: ").strip()
    if not cfg["app_password"]:
        cfg["app_password"] = getpass.getpass(
            "Gmail App Password (16 chars, hidden as you type): "
        ).strip()

    # App passwords are often shown with spaces; IMAP wants them removed.
    cfg["app_password"] = cfg["app_password"].replace(" ", "")
    return cfg


def default_output_dir() -> Path:
    """A sensible per-OS default save location."""
    home = Path.home()
    docs = home / "Documents"
    base = docs if docs.exists() else home
    return base / "HousingCasePackets"


# --------------------------------------------------------------------------- #
# Gmail / IMAP
# --------------------------------------------------------------------------- #
def connect(cfg: dict) -> imaplib.IMAP4_SSL:
    print(f"Connecting to Gmail as {cfg['email']} ...")
    imap = imaplib.IMAP4_SSL(IMAP_HOST)
    try:
        imap.login(cfg["email"], cfg["app_password"])
    except imaplib.IMAP4.error as exc:
        sys.exit(
            "Login failed: "
            f"{exc}\n\n"
            "Check that:\n"
            "  - You used a Gmail *App Password*, not your normal password\n"
            "    (https://myaccount.google.com/apppasswords)\n"
            "  - 2-Step Verification is ON for the account\n"
            "  - IMAP is enabled in Gmail Settings > Forwarding and POP/IMAP"
        )
    return imap


def search_packets(imap: imaplib.IMAP4_SSL, mailbox: str, subject: str) -> list[bytes]:
    """Return message UIDs whose subject contains `subject`."""
    status, _ = imap.select(f'"{mailbox}"', readonly=True)
    if status != "OK":
        # Fall back to the plain inbox if the Gmail folder name isn't available.
        print(f"Could not open mailbox {mailbox!r}; falling back to INBOX.")
        imap.select("INBOX", readonly=True)

    # Prefer Gmail's own search syntax (most reliable); fall back to IMAP SUBJECT.
    try:
        status, data = imap.uid("SEARCH", None, "X-GM-RAW", f'subject:"{subject}"')
        if status != "OK":
            raise imaplib.IMAP4.error(status)
    except imaplib.IMAP4.error:
        status, data = imap.uid("SEARCH", None, "SUBJECT", subject)

    if status != "OK" or not data or not data[0]:
        return []
    return data[0].split()


def fetch_message(imap: imaplib.IMAP4_SSL, uid: bytes) -> Message | None:
    status, data = imap.uid("FETCH", uid, "(RFC822)")
    if status != "OK" or not data or not data[0]:
        return None
    return email.message_from_bytes(data[0][1])


def decode_header(value: str | None) -> str:
    if not value:
        return ""
    parts = email.header.decode_header(value)
    out = []
    for text, enc in parts:
        if isinstance(text, bytes):
            out.append(text.decode(enc or "utf-8", errors="replace"))
        else:
            out.append(text)
    return "".join(out)


# --------------------------------------------------------------------------- #
# Parsing links out of an email
# --------------------------------------------------------------------------- #
def get_html_body(msg: Message) -> str:
    """Return the best-available HTML (or plain text) body of an email."""
    html, plain = "", ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if part.get("Content-Disposition", "").startswith("attachment"):
                continue
            try:
                payload = part.get_payload(decode=True)
            except Exception:
                continue
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if ctype == "text/html" and not html:
                html = text
            elif ctype == "text/plain" and not plain:
                plain = text
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html":
                html = text
            else:
                plain = text
    return html or plain


def extract_links(body: str) -> list[tuple[str, str]]:
    """Return (anchor_text, url) pairs from an email body.

    Works for HTML bodies (real <a> tags) and falls back to a regex for
    plain-text bodies where Outlook writes 'Citation<https://...>'.
    """
    links: list[tuple[str, str]] = []
    seen: set[str] = set()

    if "<a " in body.lower() or "<html" in body.lower():
        soup = BeautifulSoup(body, "html.parser")
        for a in soup.find_all("a", href=True):
            url = a["href"].strip()
            text = " ".join(a.get_text(" ", strip=True).split())
            if url.startswith("http") and url not in seen:
                seen.add(url)
                links.append((text, url))

    # Plain-text style: "Some Case Name 2026 NY Slip Op 01023 [..]<https://url>"
    for match in re.finditer(r"([^<>\n]{0,160}?)<(https?://[^>\s]+)>", body):
        text = " ".join(match.group(1).split())
        url = match.group(2).strip()
        if url not in seen:
            seen.add(url)
            links.append((text, url))

    return links


def classify(url: str) -> str:
    """Bucket a URL: 'decision_pdf', 'decision_htm', 'nyscef', or 'skip'."""
    p = urlparse(url)
    host = p.netloc.lower()
    path = p.path.lower()

    if "iapps.courts.state.ny.us" in host and "nyscef" in path:
        return "nyscef"

    if host.endswith("nycourts.gov") and "/reporter/" in path:
        if path.endswith(".pdf"):
            return "decision_pdf"
        if path.endswith(".htm") or path.endswith(".html"):
            return "decision_htm"
        return "decision_htm"  # reporter pages without extension are HTML

    return "skip"


# --------------------------------------------------------------------------- #
# Naming / filesystem helpers
# --------------------------------------------------------------------------- #
def packet_date_label(subject: str, msg: Message) -> str:
    """Best-effort 'YYYY-MM-DD' for the packet, from the subject or Date header."""
    m = re.search(r"(January|February|March|April|May|June|July|August|"
                  r"September|October|November|December)\s+(\d{1,2}),\s+(\d{4})",
                  subject, re.IGNORECASE)
    if m:
        month = MONTHS[m.group(1).lower()]
        return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(2)):02d}"

    date_hdr = msg.get("Date")
    if date_hdr:
        try:
            dt = email.utils.parsedate_to_datetime(date_hdr)
            return dt.strftime("%Y-%m-%d")
        except Exception:
            pass
    return datetime.now().strftime("%Y-%m-%d")


def slip_op_id(url: str) -> str:
    """Extract e.g. '2026_01023' from a reporter URL, else ''."""
    m = re.search(r"/(\d{4}_\d{4,6})\.(?:htm|html|pdf)", url, re.IGNORECASE)
    return m.group(1) if m else ""


def sanitize_filename(name: str, fallback: str) -> str:
    name = re.sub(r"\s+", " ", name).strip()
    # Drop common citation noise so filenames stay readable.
    name = re.sub(r"\s*\[[^\]]*\]\s*", " ", name)            # [1st Dept ...]
    name = re.sub(r"[-–—]+\s*(AD3d|Misc3d|NY3d|NYS3d).*$", "", name, flags=re.I)
    name = name.strip(" ,.-–—")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)        # illegal on Windows
    name = name[:120].strip()
    return name or fallback


def looks_like_caption(text: str) -> bool:
    """True if `text` reads like a case caption (e.g. 'Foo LLC v Bar')."""
    return bool(re.search(r"\bv\.?\b", text)) or "matter of" in text.lower()


def build_filename(text: str, url: str, ext: str) -> str:
    sid = slip_op_id(url)
    base = sanitize_filename(text, fallback="")

    # Strip a leading reporter citation like "84 Misc3d 132(A) ; " before a caption.
    base = re.sub(r"^\d+\s+(?:Misc3d|AD3d|NY3d|NYS3d)[^;]*;\s*", "", base, flags=re.I).strip()

    # If the text isn't actually a caption (common when a decision is cited
    # mid-sentence), don't use the surrounding prose as a filename — use the
    # slip-opinion id instead.
    if not base or not looks_like_caption(base):
        base = sid or Path(urlparse(url).path).stem
    elif sid and sid not in base:
        base = f"{base} - {sid}"
    return f"{base}.{ext}"


# --------------------------------------------------------------------------- #
# Downloading / rendering decisions
# --------------------------------------------------------------------------- #
def download_pdf(url: str, dest: Path, session: requests.Session) -> bool:
    try:
        resp = session.get(url, headers=BROWSER_HEADERS, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"      ! download failed: {exc}")
        return False
    dest.write_bytes(resp.content)
    return True


def html_to_pdf(url: str, dest: Path, session: requests.Session) -> bool:
    """Fetch a reporter .htm decision and save it as a PDF.

    If the page itself links to an official PDF, prefer that. Otherwise render
    the cleaned HTML to PDF with xhtml2pdf. Falls back to saving raw .html.
    """
    try:
        resp = session.get(url, headers=BROWSER_HEADERS, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"      ! fetch failed: {exc}")
        return False

    html = resp.text
    soup = BeautifulSoup(html, "html.parser")

    # Prefer an official PDF if the page links one.
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf"):
            pdf_url = urljoin(url, href)
            if download_pdf(pdf_url, dest, session):
                return True

    # Otherwise render the cleaned HTML to PDF.
    for tag in soup(["script", "style", "img", "link", "meta"]):
        tag.decompose()
    cleaned = str(soup)

    try:
        from xhtml2pdf import pisa
    except ImportError:
        alt = dest.with_suffix(".html")
        alt.write_text(html, encoding="utf-8")
        print(f"      (xhtml2pdf not installed; saved HTML instead: {alt.name})")
        return True

    try:
        with open(dest, "wb") as fh:
            result = pisa.CreatePDF(src=cleaned, dest=fh, encoding="utf-8")
        if result.err:
            raise RuntimeError(f"{result.err} rendering error(s)")
        return True
    except Exception as exc:
        if dest.exists():
            dest.unlink(missing_ok=True)
        alt = dest.with_suffix(".html")
        alt.write_text(html, encoding="utf-8")
        print(f"      ! PDF render failed ({exc}); saved HTML instead: {alt.name}")
        return True


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def process_packet(
    msg: Message,
    output_dir: Path,
    session: requests.Session,
    nyscef_rows: list[dict],
) -> dict:
    subject = decode_header(msg.get("Subject"))
    label = packet_date_label(subject, msg)
    folder = output_dir / f"{label} - Housing Case Packet"

    body = get_html_body(msg)
    links = extract_links(body)

    counts = {"downloaded": 0, "skipped_existing": 0, "nyscef": 0, "failed": 0}
    decisions = [(t, u, classify(u)) for t, u in links]
    decisions = [(t, u, k) for t, u, k in decisions if k != "skip"]

    if not decisions:
        return counts

    print(f"\n=== {subject}  ->  {folder.name}")
    folder.mkdir(parents=True, exist_ok=True)

    for text, url, kind in decisions:
        if kind == "nyscef":
            counts["nyscef"] += 1
            nyscef_rows.append(
                {"packet": label, "case": sanitize_filename(text, "(unknown)"), "url": url}
            )
            continue

        ext = "pdf"
        fname = build_filename(text, url, ext)
        dest = folder / fname

        # Idempotent: skip if we already have this PDF (or its .html fallback).
        if dest.exists() or dest.with_suffix(".html").exists():
            counts["skipped_existing"] += 1
            continue

        label_text = (text[:70] + "…") if len(text) > 70 else text
        print(f"   - {label_text or url}")

        ok = (
            download_pdf(url, dest, session)
            if kind == "decision_pdf"
            else html_to_pdf(url, dest, session)
        )
        if ok:
            counts["downloaded"] += 1
        else:
            counts["failed"] += 1

    nyscef_here = counts["nyscef"]
    if nyscef_here:
        print(f"   ({nyscef_here} NYSCEF link(s) logged for manual download)")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--output", help="Folder to save PDFs into")
    parser.add_argument("-c", "--config", default="config.ini",
                        help="Path to config file (default: config.ini)")
    parser.add_argument("--mailbox", help="IMAP mailbox to search "
                        f"(default: {DEFAULT_MAILBOX!r})")
    parser.add_argument("--subject", help="Subject text to match "
                        f"(default: {DEFAULT_SUBJECT!r})")
    parser.add_argument("--limit", type=int, default=0,
                        help="Only process the N most recent matching emails")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = script_dir / config_path

    cfg = load_config(config_path)
    mailbox = args.mailbox or cfg["mailbox"] or DEFAULT_MAILBOX
    subject = args.subject or cfg["subject"] or DEFAULT_SUBJECT
    output_dir = Path(args.output or cfg["output_dir"] or default_output_dir()).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Saving to: {output_dir}")

    imap = connect(cfg)
    try:
        uids = search_packets(imap, mailbox, subject)
        if not uids:
            print(f"No emails found with subject containing {subject!r}.")
            return
        uids = list(reversed(uids))  # newest first
        if args.limit > 0:
            uids = uids[: args.limit]
        print(f"Found {len(uids)} matching email(s).")

        session = requests.Session()
        nyscef_rows: list[dict] = []
        totals = {"downloaded": 0, "skipped_existing": 0, "nyscef": 0, "failed": 0}

        for uid in uids:
            msg = fetch_message(imap, uid)
            if msg is None:
                continue
            counts = process_packet(msg, output_dir, session, nyscef_rows)
            for k in totals:
                totals[k] += counts[k]
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    if nyscef_rows:
        csv_path = output_dir / "_NYSCEF_manual_download.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=["packet", "case", "url"])
            writer.writeheader()
            writer.writerows(nyscef_rows)
        print(f"\nNYSCEF links (open these manually): {csv_path}")

    print("\n----------------------------------------")
    print(f"Decisions downloaded : {totals['downloaded']}")
    print(f"Already had (skipped): {totals['skipped_existing']}")
    print(f"NYSCEF (manual)      : {totals['nyscef']}")
    print(f"Failed               : {totals['failed']}")
    print(f"Folder               : {output_dir}")


if __name__ == "__main__":
    main()
