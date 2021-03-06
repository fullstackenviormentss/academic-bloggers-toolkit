#!/usr/bin/env bash

VERSION="${npm_package_version?This script must be called using npm}"
SCRIPTDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOTDIR=$(cd "$SCRIPTDIR" && cd ../../ && pwd || exit)
SVNROOT=$(cd "$ROOTDIR" && cd ../SVN && pwd || exit)

# Make sure svn repo is up to date
cd "$SVNROOT" || exit
svn up

# Delete entire trunk directory
rm -rf trunk/*

# Create tag directory
mkdir -p "tags/$VERSION"

# Copy dist over to tag and trunk directory
cp -r "$ROOTDIR"/dist/* "$SVNROOT"/trunk/
cp -r "$ROOTDIR"/dist/* "$SVNROOT"/tags/"$VERSION"/

# Remove deleted files
svn stat | grep -Po '^!.+' | awk '{print $2}' | xargs svn rm

# Add new files
svn stat | grep -Po '^\?.+' | awk '{print $2}' | xargs svn add

# Commit the changes
svn ci -m "Release $VERSION"
