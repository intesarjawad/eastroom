# 3. Narration lives beside the chapters, one record per voice

Date: 2026-11-12. Status: accepted.

## Context

Version 0.1 read narration from an `audio` list inside each chapter file. Making narration after import would mean rewriting chapter files, which changes their stamps, throws away every device's stored copy of the text, and allows only one voice per chapter.

## Decision

A narration record is its own small file, `voice/<voice>/<chapter>.json`: the audio files, the start and end of every sentence, and a hash of the chapter text it was made from. Audio sits under the book's media folder. Chapter files are never rewritten. The library listing gives each chapter the stamps of its records, and the reader plays the best voice a chapter has.

A narrator is anything that writes this record. The two that ship speak one sentence at a time and measure each sentence as it is made, so the times are exact without a second model listening to the result.

## Why

- Text and voice change independently. A better voice arriving does not make a phone download the book again.
- Addresses carry stamps, so a device may keep text and audio for good and still pick up a new take.
- The text hash lets Home drop a record whose chapter was imported again with different text.

## Considered

- EPUB Media Overlays: a good interchange format, but it ties timing to XHTML fragments that East Room does not keep.
- Aligning finished audio to text with a second model: needed for outside audiobooks, not for audio East Room makes itself, and it drifts.

## Cost

One more request per chapter. Narration that older versions stored inside chapter files is copied once into records under the voice name `recorded`.
