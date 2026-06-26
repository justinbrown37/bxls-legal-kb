# Housing Case Packet downloader — simple setup guide

This tool reads your Gmail, finds every **"Housing Case Packet"** email, and
downloads the court decisions linked inside them as PDFs into a folder on your
PC — one folder per weekly packet.

You do **not** need to know any programming. You just install Python once, save
one file, and double-click it. The tool asks for your email and password the
first time and remembers them after that.

> NYSCEF documents are login-protected and not downloaded automatically. They're
> listed in a file called `_NYSCEF_manual_download.csv` so you can open those by
> hand. Everything from the public court website (`nycourts.gov`) is downloaded.

---

## Step 1 — Install Python (one time, ~3 minutes)

1. Go to **<https://www.python.org/downloads/>** and click the big yellow
   **"Download Python"** button.
2. Open the file that downloads (it's in your Downloads folder).
3. **IMPORTANT:** On the very first screen of the installer, check the box at the
   bottom that says **"Add python.exe to PATH"**. ✅
4. Click **"Install Now"** and wait for it to finish. Click Close.

That's the only software you need to install.

---

## Step 2 — Get a Gmail "App Password" (one time, ~3 minutes)

Gmail won't let a program use your normal password, so you create a special
16-character one just for this tool.

1. Turn on 2-Step Verification (if it isn't already):
   **<https://myaccount.google.com/security>** → "2-Step Verification".
2. Go to **<https://myaccount.google.com/apppasswords>**.
3. Type a name like **Housing packets** and click **Create**.
4. Google shows you **16 letters** in a box. Leave this open / copy it — you'll
   paste it into the tool in Step 4. (Spaces don't matter.)
5. Also make sure IMAP is on: in Gmail, click the ⚙️ gear → **See all settings**
   → **Forwarding and POP/IMAP** → choose **Enable IMAP** → **Save Changes**.

---

## Step 3 — Save the tool to your Desktop (one time)

1. Open this file on GitHub:
   **`housing_packet_scraper/fetch_housing_packets.py`**
2. Click the **download icon** (a downward arrow ⬇, near the top-right of the
   file view). This saves `fetch_housing_packets.py` to your Downloads.
3. Move that file to your **Desktop** so it's easy to find.

---

## Step 4 — Run it

1. **Double-click** `fetch_housing_packets.py` on your Desktop. A black window
   opens.
   - The first time, it spends about a minute setting itself up — that's normal.
2. It asks for your **Gmail address** — type it and press Enter.
3. It asks for your **App Password** — paste the 16 characters from Step 2 and
   press Enter. (You won't see anything appear as you paste — that's intentional.)
4. It offers to remember these — press Enter for yes.
5. It downloads everything and prints a summary.

Your decisions are now here:

```
Documents\HousingCasePackets\
    2026-02-24 - Housing Case Packet\
        West Side Marquis LLC v Maldonado - 2026_01023.pdf
        ...
    _NYSCEF_manual_download.csv   (links to open by hand)
```

**To get new packets later, just double-click the file again.** It skips
anything you already have and only grabs what's new.

---

## If something goes wrong

The window stays open and shows a message — here are the common ones:

- **"Login failed"** → The most common cause is using your normal password
  instead of the **App Password** from Step 2. Also confirm 2-Step Verification
  is on and IMAP is enabled in Gmail settings.
- **The window flashes and closes instantly** → Python probably didn't install
  with "Add to PATH" checked. Re-run the Python installer (Step 1), choose
  "Modify," and make sure that box is checked.
- **A few files saved as `.html` instead of `.pdf`** → That page wouldn't
  convert; the `.html` file opens fine in any browser, and you can print it to
  PDF from there if you want.
- **"No emails found"** → Make sure you're signing in with the same Gmail
  account that has the packets.

If you're stuck, send me the text from that black window and I'll sort it out.

---

### For the technically curious

- `config.ini` (created when you choose "remember") stores your settings and is
  gitignored so it's never uploaded. You can also set `GMAIL_ADDRESS` /
  `GMAIL_APP_PASSWORD` environment variables instead.
- Command-line options: `--output <folder>`, `--limit <N>`, `--subject <text>`,
  `--help`.
- The tool reads mail read-only and never sends or deletes anything.
