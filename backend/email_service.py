"""Transactional email (Resend) — The Collective Savers™.

A tiny, self-contained, non-blocking email layer. Every public helper is async
and swallows its own errors so a mail failure can never break a request flow.
If RESEND_API_KEY / SENDER_EMAIL are not configured, sends are skipped (logged),
so the app runs fine without email credentials.
"""
import os
import asyncio
import logging

import resend
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("collective-savers.email")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL")
APP_BASE_URL = (os.environ.get("APP_BASE_URL") or "").rstrip("/")
BRAND = "The Collective Savers"
ACCENT = "#FF5400"
INK = "#0f172a"

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


async def send_email(to: str, subject: str, html: str):
    """Send one HTML email. Returns the Resend response or None (never raises)."""
    if not to:
        return None
    if not RESEND_API_KEY or not SENDER_EMAIL:
        logger.warning("Resend not configured — skipping email '%s' to %s", subject, to)
        return None
    params = {"from": f"{BRAND} <{SENDER_EMAIL}>", "to": [to], "subject": subject, "html": html}
    try:
        return await asyncio.to_thread(resend.Emails.send, params)
    except Exception as e:  # noqa: BLE001
        logger.error("Resend send failed to %s: %s", to, e)
        return None


# ---------------------------------------------------------------- templates ---
def _row(label: str, value) -> str:
    return (f'<tr><td style="padding:7px 0;font-size:13px;color:#64748b;width:44%">{label}</td>'
            f'<td style="padding:7px 0;font-size:13px;color:{INK};font-weight:600">{value}</td></tr>')


def _button(label: str, url: str) -> str:
    if not (label and url):
        return ""
    return (f'<tr><td style="padding:18px 0 4px"><a href="{url}" '
            f'style="display:inline-block;background:{ACCENT};color:#fff;text-decoration:none;'
            f'font-weight:700;padding:12px 24px;border-radius:10px;font-size:14px">{label}</a></td></tr>')


def _wrap(heading: str, intro: str, rows_html: str = "", cta: str = "", footnote: str = "") -> str:
    return f"""<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px 0;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:{INK};padding:20px 28px">
<span style="color:#fff;font-size:17px;font-weight:800;letter-spacing:.5px">THE COLLECTIVE SAVERS</span>
<span style="color:{ACCENT};font-size:11px;font-weight:700"> &nbsp;Regional Product Waves&copy;</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.2;color:{INK}">{heading}</h1>
<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#334155">{intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 4px">{rows_html}{cta}</table>
<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#94a3b8">{footnote}</p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9;font-size:11px;line-height:1.5;color:#94a3b8">
You're receiving this because you joined a Wave at {BRAND}. Your card is only ever charged when a Wave activates.</td></tr>
</table></td></tr></table></body></html>"""


def _wave_url(wave: dict) -> str:
    wid = (wave or {}).get("wave_id")
    return f"{APP_BASE_URL}/wave/{wid}" if (APP_BASE_URL and wid) else ""


# ------------------------------------------------------------- public helpers --
async def send_join_confirmation(to, name, wave, units, fitting_label=None, delivery_address=None):
    rows = _row("Wave", wave.get("title")) + _row("Region", wave.get("region_name")) + _row("Units reserved", units)
    if fitting_label:
        rows += _row("Preferred fitting", fitting_label)
    if delivery_address:
        rows += _row("Delivery to", delivery_address)
    intro = (f"Hi {name or 'there'}, your reservation on <b>{wave.get('title')}</b> is locked in. "
             f"Your card is <b>not charged yet</b> — payment is only captured once this Wave hits its activation target.")
    foot = "We'll email you the moment the Wave activates so you can complete checkout."
    if fitting_label:
        foot = "Your tyres ship to your chosen garage. Fitting is arranged with and charged separately by the garage."
    html = _wrap("You're in — reservation confirmed", intro, rows, _button("View your Wave", _wave_url(wave)), foot)
    return await send_email(to, f"Reservation confirmed · {wave.get('title')}", html)


async def send_wave_activation(to, name, wave):
    rows = (_row("Wave", wave.get("title")) + _row("Region", wave.get("region_name"))
            + _row("Committed", f"{wave.get('units_committed')} / {wave.get('ideal_target')} units"))
    intro = (f"Great news{', ' + name if name else ''} — <b>{wave.get('title')}</b> just reached its activation target! "
             f"We're now capturing payment for reserved orders at the locked Wave price.")
    html = _wrap("Your Wave just activated", intro, rows,
                 _button("Complete your order", _wave_url(wave)),
                 "If you reserved units, open the Wave to finish checkout before the payment window closes.")
    return await send_email(to, f"Activated · {wave.get('title')}", html)


async def send_payment_receipt(to, name, wave, amount, units, fitting_label=None):
    rows = (_row("Wave", wave.get("title")) + _row("Amount paid", f"£{float(amount or 0):.2f}")
            + _row("Units", units))
    if fitting_label:
        rows += _row("Fitting appointment", fitting_label)
    intro = f"Thanks{', ' + name if name else ''} — your payment for <b>{wave.get('title')}</b> is complete and your order is confirmed."
    if fitting_label:
        intro += (" Your fitting slot is booked — please arrive a few minutes early. "
                  "<b>Fitting is charged separately by the garage</b> on the day.")
    html = _wrap("Payment received — order confirmed", intro, rows,
                 _button("View your order", _wave_url(wave)),
                 "Keep this email as your receipt.")
    return await send_email(to, f"Receipt · {wave.get('title')}", html)
