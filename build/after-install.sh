#!/bin/sh
ln -sf /opt/Mailwrap/mailwrap /usr/bin/mailwrap
# SUID sandbox helper must be root-owned with 4755, else Chromium refuses to start on some distros
chmod 4755 /opt/Mailwrap/chrome-sandbox 2>/dev/null || true
update-desktop-database /usr/share/applications 2>/dev/null || true
