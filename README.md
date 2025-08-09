# autocommit

Git outta your way.

You focus on code changes while autocommit creates local conventional commits
with meaningful descriptions, merges with WIP at head, and squash local commits
when they're too cluttered.

Unless you tell it to, autocommit only touches local commits to avoid force
pushing.

## Roadmaps

1. [ ] Properly retrieves git info
1. [ ] Communicate with LLM
1. [ ] Initial prompt optimization
1. [ ] Whole-file commits
1. [ ] Partial commits (hunks)
1. [ ] Squash local commits by looking at diffs
1. [ ] Watch mode
1. [ ] CI/CD
   1. [ ] semantic-release
      1. [ ] npm
      1. [ ] jsr
1. [ ] VS Code plugin
1. [ ] Implement in different langauges for fun
   1. [ ] Python
   1. [ ] Go
   1. [ ] Rust
