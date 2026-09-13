"""Prevent managed player traffic from falling back onto an unencrypted LAN route."""
import ipaddress
import json
from pathlib import Path
import subprocess

GUARD = Path('/etc/openframe/managed-network.json')


def guard(address):
    ip = ipaddress.IPv4Address(address)
    if not ip.is_private or ip.is_loopback or ip.is_link_local:
        raise ValueError('Managed VPN requires a private IPv4 address')
    rule = ['OUTPUT', '-d', str(ip), '!', '-o', 'wg-openframe', '-j', 'REJECT']
    check = subprocess.run(['iptables', '-w', '-C', *rule], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    if check.returncode:
        subprocess.run(['iptables', '-w', '-I', *rule], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)


if __name__ == '__main__':
    try:
        guard(json.loads(GUARD.read_text())['address'])
    except Exception:
        raise SystemExit('Managed VPN route guard failed') from None
