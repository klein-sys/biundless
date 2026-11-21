const clipUrls = import.meta.glob<string>('./voice/*.{mp3,wav}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function getDialogueClip(id: string): string | undefined {
  return clipUrls[`./voice/${id}.mp3`] ?? clipUrls[`./voice/${id}.wav`];
}
