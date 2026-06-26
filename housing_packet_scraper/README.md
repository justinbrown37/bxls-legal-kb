# Housing Case Packet downloader

Automatically pulls every **"Housing Case Packet"** email out of your Gmail and
saves the court decisions linked inside them as PDFs on your computer, organized
into one folder per weekly packet.

- ✅ Official NY court decisions on `nycourts.gov` are downloaded as PDF
  (direct PDFs are saved as-is; `.htm` slip-opinion pages are converted to PDF).
- 🔒 **NYSCEF** documents (`iapps.courts.state.ny.us`) are login-walled and have
  anti-scraping protections, so the tool does **not** try to scrape them.
  Instead it writes them to `_NYSCEF_manual_download.csv` so you can open and
  save those by hand.
- Statute / reference links (NY Senate, AmLegal, Cornell, etc.) are ignored.

The tool is **read-only** for your email and **safe to re-run** — anything you
already downloaded is skipped.

---

## One-time setup (Windows)

### 1. Install Python
Download Python 3.10+ from <https://www.python.org/downloads/windows/> and run
the installer. **On the first screen, check "Add python.exe to PATH."**

### 2. Get the files
Put this `housing_packet_scraper` folder somewhere easy, e.g. your Desktop.

### 3. Install the dependencies
Open **Command Prompt** (press Start, type `cmd`, Enter), then:

```
cd %USERPROFILE%\Desktop\housing_packet_scraper
pip install -r requirements.txt
```

### 4. Create a Gmail App Password
A normal Gmail password won't work over IMAP. You need a 16-character
*App Password*:

1. Turn on 2-Step Verification: <https://myaccount.google.com/security>
2. Create an App Password: <https://myaccount.google.com/apppasswords>
   (name it anything, e.g. "Housing packets"). Google shows you 16 characters.
3. Make sure IMAP is enabled: Gmail → Settings (gear) → **See all settings** →
   **Forwarding and POP/IMAP** → **Enable IMAP** → Save.

### 5. Fill in your config
Copy `config.example.ini` to `config.ini` and open it in Notepad. Put in your
email address and the 16-character App Password. Save.

> `config.ini` is gitignored, so your password is never committed to the repo.
> If you'd rather not store it in a file, leave `app_password` blank and the
> script will prompt you for it (hidden) each time you run it.

---

## Running it

From the same Command Prompt:

```
python fetch_housing_packets.py
```

That's it. You'll see it find the packets, download decisions, and print a
summary. By default everything lands in:

```
C:\Users\<you>\Documents\HousingCasePackets\
    2026-02-24 - Housing Case Packet\
        West Side Marquis LLC v Maldonado - 2026_01023.pdf
        ...
    _NYSCEF_manual_download.csv
```

### Options

```
python fetch_housing_packets.py --output "D:\Cases"   # save somewhere else
python fetch_housing_packets.py --limit 3             # only the 3 newest packets
python fetch_housing_packets.py --subject "housing case packet"
python fetch_housing_packets.py --help
```

---

## How it decides what to download

| Link in the email                                   | Action                         |
| --------------------------------------------------- | ------------------------------ |
| `nycourts.gov/reporter/.../*.pdf`                   | Download the PDF               |
| `nycourts.gov/reporter/.../*.htm`                   | Convert the decision to PDF    |
| `iapps.courts.state.ny.us/nyscef/...`               | Log to CSV (manual download)   |
| Statutes / other reference links                    | Ignored                        |

## Troubleshooting

- **"Login failed"** — Double-check you used an *App Password* (not your normal
  password), that 2-Step Verification is on, and that IMAP is enabled in Gmail.
- **"Missing dependency"** — Re-run `pip install -r requirements.txt`.
- **A few decisions saved as `.html` instead of `.pdf`** — The PDF renderer
  couldn't handle that particular page; the `.html` file opens fine in any
  browser and you can print-to-PDF from there if you want.
- **Nothing found** — Confirm the emails really are in this account and the
  subject contains "housing case packet" (run with `--subject` to adjust).

## Note on NYSCEF / authorized use

This tool only downloads decisions from the public New York State Law Reporting
Bureau site (`nycourts.gov`). It deliberately does **not** circumvent NYSCEF's
access controls or anti-scraping measures — those documents are listed for you
to retrieve manually through normal, authorized access.
