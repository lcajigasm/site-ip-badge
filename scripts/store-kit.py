#!/usr/bin/env python3
"""Builds dist/store-submission-<version>/ (and a zip of it) with everything the
Chrome Web Store Developer Dashboard asks for: the extension package, the store
icon, screenshots, promo tiles and a LISTING.txt with the form text field by field.

Requires Pillow. Run scripts/zip.sh and `cd test && npm run screenshots` first."""
import json, os, shutil, sys, zipfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
manifest = json.load(open(os.path.join(ROOT, 'src/manifest.json')))
VERSION = manifest['version']
en = json.load(open(os.path.join(ROOT, 'src/_locales/en/messages.json')))
NAME = en['extName']['message']
SUMMARY = en['extDescription']['message']
REPO = 'https://github.com/lcajigasm/site-ip-badge'
PKG = os.path.join(ROOT, f'dist/site-ip-badge-{VERSION}.zip')
OUT = os.path.join(ROOT, f'dist/store-submission-{VERSION}')

if not os.path.exists(PKG):
    sys.exit(f'{PKG} missing: run scripts/zip.sh first')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(os.path.join(OUT, 'screenshots'))

# 1. package + icon + screenshots
shutil.copy(PKG, OUT)
shutil.copy(os.path.join(ROOT, 'docs/store/icon128-store.png'), os.path.join(OUT, 'store-icon-128x128.png'))
shots = sorted(f for f in os.listdir(os.path.join(ROOT, 'docs/screenshots')) if f.startswith('store-'))
for f in shots:
    im = Image.open(os.path.join(ROOT, 'docs/screenshots', f)).convert('RGB')
    assert im.size == (1280, 800), f
    im.save(os.path.join(OUT, 'screenshots', f.replace('store-', 'screenshot-')), optimize=True)

# 2. promo tiles
def font(size, bold=False):
    for p in (['/System/Library/Fonts/Supplemental/Arial Bold.ttf'] if bold else ['/System/Library/Fonts/Supplemental/Arial.ttf']):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

icon = Image.open(os.path.join(ROOT, 'src/icons/icon128.png')).convert('RGBA')

def tile(w, h, out, icon_size, title_size, sub_size):
    im = Image.new('RGB', (w, h), (23, 64, 140))
    d = ImageDraw.Draw(im)
    # subtle bottom band
    d.rectangle((0, int(h * 0.72), w, h), fill=(17, 48, 108))
    ic = icon.resize((icon_size, icon_size), Image.LANCZOS)
    pad = int(h * 0.12)
    im.paste(ic, (pad, (int(h * 0.72) - icon_size) // 2), ic)
    x = pad * 2 + icon_size
    d.text((x, int(h * 0.18)), NAME, fill='white', font=font(title_size, True))
    d.text((x, int(h * 0.18) + title_size + 12), 'Server IP · provider · protocol\nof the page you are on', fill=(200, 215, 240), font=font(sub_size))
    # fake badge in the band
    bf = font(int(sub_size * 0.95))
    label = '104.20.23.154  Cloudflare · h2'
    tw = d.textlength(label, font=bf)
    bx, by = w - int(tw) - pad - 24, int(h * 0.72) + (h - int(h * 0.72) - sub_size - 14) // 2
    d.rounded_rectangle((bx, by, bx + int(tw) + 24, by + sub_size + 14), radius=6, fill=(245, 245, 245), outline=(138, 138, 138))
    d.text((bx + 12, by + 6), label, fill=(34, 34, 34), font=bf)
    im.save(out, optimize=True)

tile(440, 280, os.path.join(OUT, 'promo-small-440x280.png'), 128, 34, 18)
tile(1440, 560, os.path.join(OUT, 'promo-marquee-1440x560.png'), 256, 72, 36)

# 3. listing text
listing = f"""CHROME WEB STORE SUBMISSION KIT — {NAME} {VERSION}
============================================================
Dashboard: https://chrome.google.com/webstore/devconsole
Guide: PUBLISH.md in the repository.

FILES IN THIS FOLDER
--------------------
site-ip-badge-{VERSION}.zip        -> "Add new item" / Package > Upload new package
store-icon-128x128.png             -> Store listing > Store icon
screenshots/screenshot-*.png       -> Store listing > Screenshots (1280x800, upload all)
promo-small-440x280.png            -> Store listing > Small promo tile (optional)
promo-marquee-1440x560.png         -> Store listing > Marquee promo tile (optional)

STORE LISTING
-------------
Name (from manifest):
{NAME}

Summary (from manifest description, {len(SUMMARY)} chars):
{SUMMARY}

Category:
Developer Tools

Language:
English (Spanish UI included via _locales/es)

Detailed description:
{NAME} shows the IP address of the server that delivered the page you are looking at, as a small badge in the bottom-right corner of every http/https page, together with who is behind that IP.

What it does
• Shows the real IP of the connection (IPv4 or IPv6), taken from the response the browser received. It reflects CDNs, load balancers and redirects, not just what DNS says.
• Shows who is behind the IP: the hosting provider or CDN (Cloudflare, Fastly, CloudFront, Akamai, Vercel, Netlify, GitHub, Google and more) detected from the response headers, plus the HTTP protocol (h2, h3).
• Hover the badge and it jumps to the other corner so it never hides what you are reading.
• Click the badge to copy the IP. Double click to hide it until the page is reloaded.
• Toolbar popup with the details of the current tab: host, IP and its source, provider, Server header, HTTP status, protocol, copy, on-demand reverse DNS, and a switch to hide the badge on that site.
• If the connection IP is not available (a tab restored after restarting the browser, a page served from cache), it can resolve the host name through DNS over HTTPS and shows a "DNS" tag so you know the difference. This fallback can be switched off.
• Options: corner (left/right), font size, DNS fallback on/off, details on/off, list of sites where the badge is hidden.

What it does not do
• No analytics, no telemetry, no accounts, no remote code.
• It never sends the pages you visit anywhere. The only network requests are the optional DNS fallback (host name to dns.google) and the reverse DNS lookup in the popup (IP to dns.google, only when you click).

Built as a Manifest V3 replacement for the discontinued "Website IP" extension. Open source: {REPO}

Official URL / Homepage:
{REPO}

Support URL:
{REPO}/issues

PRIVACY TAB
-----------
Single purpose:
Show the IP address and hosting provider of the server of the current website in a corner of the page.

Permission justification — webRequest:
Read details.ip and the response headers (to detect the hosting provider / CDN) from onResponseStarted for the main-frame document of each tab. Observation only; nothing is blocked or modified.

Permission justification — host permissions (<all_urls>):
Needed to observe the main-frame response of any site and to inject the badge on any http/https page.

Permission justification — storage:
Keep the IP and provider per tab in storage.session (cleared when the browser closes) and the user preferences, including the list of sites where the badge is hidden, in storage.sync.

Are you using remote code?
No, I am not using remote code.

Data usage:
Tick "Does not collect or use user data" for every category. Certify the three limited-use disclosures.

Privacy policy URL:
{REPO}/blob/main/PRIVACY.md

DISTRIBUTION TAB
----------------
Payments: Free
Visibility: Public (or Unlisted for a first trial)
Regions: All regions

TEST INSTRUCTIONS (for reviewers)
---------------------------------
No login needed. Open any https page (for example https://example.com): the server IP and provider appear in the bottom-right corner. Move the mouse over the badge and it jumps to the bottom-left. Click copies the IP; double click hides it. The toolbar icon opens a popup with the details of the tab (provider, protocol, reverse DNS) and a link to the options.

ACCOUNT TAB (one time)
----------------------
• Pay the 5 USD registration fee.
• Enable 2-step verification on the Google account.
• Set the publisher display name and a contact email, then verify the email.
• EU trader status: "Not a trader" for a free, non-monetised extension.
"""
open(os.path.join(OUT, 'LISTING.txt'), 'w').write(listing)

# 4. zip the kit
kit = OUT + '.zip'
with zipfile.ZipFile(kit, 'w', zipfile.ZIP_DEFLATED) as z:
    for dp, _, fs in os.walk(OUT):
        for f in fs:
            p = os.path.join(dp, f)
            z.write(p, os.path.relpath(p, os.path.dirname(OUT)))
print('kit:', OUT)
print('zip:', kit)
for dp, _, fs in os.walk(OUT):
    for f in sorted(fs):
        print('  ', os.path.relpath(os.path.join(dp, f), OUT))
