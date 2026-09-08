"""A verified-first opener that tolerates Energi Data Service's chain breaking.

EDS periodically serves its leaf certificate without the intermediate. Browsers
and curl fetch the missing intermediate over AIA and never notice; Python
cannot, so every request fails with CERTIFICATE_VERIFY_FAILED until Energinet
repairs it. On 2026-09-08 that lasted most of a day and stopped both the price
forecast and this archive.

The fallback is narrow on purpose. It applies only to the hosts named here, and
only after a verified attempt has failed with that specific error — normal
operation is fully verified, and any other TLS failure is still a failure. The
data behind it is public wholesale prices that the QA suite cross-checks
against ENTSO-E, so reading it unverified on the rare day Energinet misconfigures
their chain costs less than losing the day's data.
"""
import ssl
import urllib.error
import urllib.parse
import urllib.request

FALLBACK_HOSTS = ("api.energidataservice.dk",)


def _unverified_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def urlopen(url_or_req, timeout=120):
    """urllib.request.urlopen, retried without verification for FALLBACK_HOSTS
    when — and only when — the certificate chain cannot be built."""
    url = url_or_req if isinstance(url_or_req, str) else url_or_req.full_url
    try:
        return urllib.request.urlopen(url_or_req, timeout=timeout)
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        if not (isinstance(reason, ssl.SSLCertVerificationError)
                and any(h in url for h in FALLBACK_HOSTS)):
            raise
        host = urllib.parse.urlsplit(url).hostname
        print(f"  {host} has a broken certificate chain — "
              f"retrying without verification", flush=True)
        return urllib.request.urlopen(url_or_req, timeout=timeout,
                                      context=_unverified_ctx())
