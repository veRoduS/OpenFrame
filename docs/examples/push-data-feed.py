#!/usr/bin/env python3
"""Send a complete OpenFrame snapshot; credentials come from environment secrets."""
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import uuid


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: push-data-feed.py snapshot.json')
    base = os.environ.get('OPENFRAME_URL', '').rstrip('/')
    parsed = urlsplit(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.query or parsed.fragment or parsed.path:
        raise SystemExit('OPENFRAME_URL must be an http(s) origin without credentials or a path')
    try:
        feed_id = str(uuid.UUID(os.environ.get('OPENFRAME_FEED_ID', '')))
    except ValueError:
        raise SystemExit('Set OPENFRAME_FEED_ID to a feed UUID') from None
    token = os.environ.get('OPENFRAME_FEED_TOKEN', '')
    if not re.fullmatch(r'ofd_[A-Za-z0-9_-]{43}', token):
        raise SystemExit('Set OPENFRAME_FEED_TOKEN to the issued update token')
    body = Path(sys.argv[1]).read_bytes()
    try:
        data = json.loads(body, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except ValueError:
        raise SystemExit('Payload must be valid JSON with finite numbers') from None
    if not isinstance(data, dict) or len(body) > 32768:
        raise SystemExit('Payload must be a JSON object of at most 32,768 bytes')
    request = urllib.request.Request(f'{base}/api/data-feeds/{feed_id}/data', data=body, method='PUT',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    # Never follow redirects carrying the bearer token to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    client = urllib.request.build_opener(NoRedirect)
    for attempt in range(3):
        try:
            with client.open(request, timeout=10) as response:
                print(response.read().decode('utf-8'))
                return
        except urllib.error.HTTPError as error:
            if attempt == 2 or (error.code != 429 and error.code < 500):
                raise SystemExit(f'HTTP {error.code}: {error.read(4096).decode("utf-8", errors="replace")}') from None
            retry = error.headers.get('Retry-After', '')
            delay = int(retry) if error.code == 429 and retry.isdecimal() else 2 ** attempt
            if delay > 120:
                raise SystemExit(f'HTTP {error.code}: Retry-After exceeds retry budget; reschedule later') from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise SystemExit('Connection failed after three attempts') from None
            delay = 2 ** attempt
        time.sleep(delay)


if __name__ == '__main__':
    main()
