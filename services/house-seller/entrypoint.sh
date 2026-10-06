#!/bin/sh
set -eu
# The persistent mount replaces image-directory ownership on a fresh Render disk.
install -d -o 65534 -g 65534 /var/lib/table
exec setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all --no-new-privs /usr/local/bin/house-seller
