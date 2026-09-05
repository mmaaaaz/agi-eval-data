#!/usr/bin/env python3
"""quota_check.py — preflight per plan v6 Task 0.6. Uses RW creds if present."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

for env in ("DRIVE_CLIENT_ID", "DRIVE_CLIENT_SECRET", "DRIVE_RW_REFRESH_TOKEN"):
    if os.environ.get(env):
        sys.path.insert(0, HERE)
        import drive_io as DIO
        break
else:
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    from drive_common import get_service as _gs

    class _W:
        @staticmethod
        def service():
            return _gs()

    import drive_io as DIO  # noqa: E402  (service monkeypatched below)

    DIO.service = _W.service

G = 1024 ** 3


def main():
    svc = DIO.service()
    a = svc.about().get(
        fields="user(emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)"
    ).execute()
    q = a["storageQuota"]
    lim = int(q.get("limit") or 0)
    usage = int(q.get("usage", 0))
    print(f"account : {a['user']['emailAddress']}")
    print(f"quota   : {usage/G:.2f} / {lim/G:.2f} GiB  (free {(lim-usage)/G:.2f} GiB)")
    free = lim - usage
    if free < 1 * G:
        print("FAIL: <1 GiB free — sibling uploads + journal at risk")
        sys.exit(2)
    print("PASS — headroom OK for siblings + journal")


if __name__ == "__main__":
    main()
