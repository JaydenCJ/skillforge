# Syllable counting rules

`scripts/check-haiku.mjs` counts syllables per word with a deterministic
heuristic:

1. Lowercase the word and strip anything that is not a letter.
2. Count maximal groups of vowels (`a e i o u y`) — each group is one
   syllable candidate.
3. Subtract one for a silent trailing `e` (but not for `-le` endings such
   as "table", and never below one syllable).
4. Every word has at least one syllable.

## Known limitations

- Loanwords and acronyms ("API", "OAuth") are counted by their letters'
  vowel groups, which may not match how you pronounce them.
- Hyphenated identifiers are split on the hyphen and counted per part.

When the checker and a human disagree, the human wins — the checker exists
to catch obvious 6-8-6 mistakes, not to litigate phonology.
