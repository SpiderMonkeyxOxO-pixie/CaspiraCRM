# Release evidence (host only, not committed)

One directory per release ID, written by scripts/build-release.sh:
manifest.json (digests, commit, migration version), sbom-*.cdx.json,
scan reports and test results. The configuration backup includes this
directory so release history survives a host loss.
