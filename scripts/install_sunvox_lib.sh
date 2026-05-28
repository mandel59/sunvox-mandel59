#!/bin/sh

set -eu

cd "$(dirname "$0")/.."

sunvox_lib_url="https://warmplace.ru/soft/sunvox/sunvox_lib-2.1.4d.zip"
archive_name="sunvox_lib-2.1.4d.zip"
sha256sum="abe851de9d65a10e06673bf33257154591a2ff63ad2bb298488a5941cc5f4057"

test -f var/"$archive_name" || curl -L -o var/"$archive_name" "$sunvox_lib_url"

echo "$sha256sum  var/$archive_name" | sha256sum -c -

unzip -o var/"$archive_name" 'sunvox_lib/sunvox_lib/js/lib/*' 'sunvox_lib/sunvox_lib/docs/license/*'
