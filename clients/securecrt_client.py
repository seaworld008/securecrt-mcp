#!/usr/bin/env python3
"""Thin local CLI wrapper. Native persistent MCP is preferred for agents.

Command JSON is forwarded as a file/stdin, never concatenated into a shell command.
No credentials, SDK dependencies, auto retries, automatic interrupt or idle ack.
"""
import argparse
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', default='securecrt-mcp')
    subs = parser.add_subparsers(dest='action', required=True)
    subs.add_parser('sessions')
    view = subs.add_parser('screen'); view.add_argument('--session', required=True)
    for action in ('run', 'policy-check'):
        p = subs.add_parser(action); p.add_argument('--input', required=True, help='UTF-8 JSON path or - for stdin')
    args = parser.parse_args()
    argv = [args.binary, args.action]
    if args.action == 'screen':
        argv.extend(['--session', args.session])
    if args.action in ('run', 'policy-check'):
        argv.extend(['--input', args.input])
    # Inherit byte streams; avoid Windows locale recoding and preserve JSON stdout.
    try:
        return subprocess.run(argv, check=False, shell=False).returncode
    except OSError as error:
        print('Cannot launch securecrt-mcp: ' + str(error), file=sys.stderr)
        return 127


if __name__ == '__main__':
    sys.exit(main())
