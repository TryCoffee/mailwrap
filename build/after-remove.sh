#!/bin/sh
# rpm: $1 is the number of remaining instances (0 = uninstall, 1 = upgrade/reinstall)
# deb: $1 is "remove" / "purge" on uninstall, "upgrade" otherwise
case "$1" in
  0|remove|purge) [ -L /usr/bin/mailwrap ] && rm -f /usr/bin/mailwrap ;;
esac
exit 0
