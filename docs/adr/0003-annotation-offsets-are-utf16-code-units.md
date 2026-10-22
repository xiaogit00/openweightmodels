# Annotation offsets are UTF-16 code units

Annotation offsets index `responses.content_md` as UTF-16 code units, matching JavaScript string indexing and browser selection. The server derives the quote from the raw slice and ignores client-supplied quotes. We chose this over Unicode code points because every boundary that produces or consumes an offset — DOM selection, range splitting, rendering — is JavaScript, and converting at each boundary invites silent drift on emoji and astral characters.

**Considered options**: Unicode code points would be language-neutral but require conversion at every JS boundary; serialized DOM ranges would break on every re-render; offsets into a plain-text projection would move every highlight when the renderer changes.

**Consequences**: offset logic must stay in TypeScript (or convert explicitly before touching Postgres `substring`), and tests must include emoji and CJK fixtures. Offsets cannot be reused by a non-JavaScript service without conversion.
