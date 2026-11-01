// `pnpm commit` asks for each part of a Conventional Commit, then runs `git commit`.
// The types are the ones commitlint's conventional config accepts, so the git-hooks check passes.
export default {
  useEmoji: false,
  allowCustomScopes: true,
  allowEmptyScopes: true,
  allowBreakingChanges: ['feat', 'fix'],
  maxHeaderLength: 100,
  // Offered as a list; anything else can be typed. Add your apps and areas.
  scopes: ['deps', 'ci'],
  skipQuestions: ['footerPrefix'],
  types: [
    { value: 'feat', name: 'feat:     A new feature' },
    { value: 'fix', name: 'fix:      A bug fix' },
    { value: 'docs', name: 'docs:     Documentation only' },
    { value: 'style', name: 'style:    Formatting, no change to behaviour' },
    { value: 'refactor', name: 'refactor: Neither a fix nor a feature' },
    { value: 'perf', name: 'perf:     Makes it faster' },
    { value: 'test', name: 'test:     Add or fix tests' },
    { value: 'build', name: 'build:    Build system or dependencies' },
    { value: 'ci', name: 'ci:       CI configuration' },
    { value: 'chore', name: 'chore:    Anything else that is not in src or tests' },
    { value: 'revert', name: 'revert:   Revert an earlier commit' },
  ],
};
