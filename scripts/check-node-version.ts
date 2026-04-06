const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 20 || (major === 20 && minor < 9)) {
  console.error(
    `msksim requires Node ≥ 20.9 (found v${process.versions.node}). See the "Stack and versions" section of CLAUDE.md`,
  );
  process.exit(1);
}
