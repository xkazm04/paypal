// Words of the Set up page's rules step: one small card instead of the full editor. Sentence case.
export const STARTER = {
  title: 'Pick how much your agents may spend',
  sizes: [
    { key: 'careful', label: 'Careful', line: 'Up to $100 a deal, $150 a day' },
    { key: 'everyday', label: 'Everyday', line: 'Up to $250 a deal, $400 a day' },
    { key: 'roomy', label: 'Roomy', line: 'Up to $500 a deal, $1,000 a day' },
  ],
  sizesLabel: 'Spending size',
  reads: 'In plain words',
  go: 'Review and sign',
  goTitle: 'Opens the approval window with these rules filled in. Nothing is signed until you sign there.',
  safe: 'You check the rules and sign in the approval window. Payments are limited to the practice shop until you add others.',
  back: 'Change the choice',
  own: 'Write your own rules instead',
} as const;
