# Annotations anchor to raw markdown text nodes

Annotation offsets are stored against the immutable raw `content_md`. Rendering parses that markdown into an mdast and emits rendered text nodes carrying their source offsets; an annotation must fall inside a single text node, and overlapping ranges are rejected. We chose this over offsets into a normalized plain-text projection, because changing the renderer would silently move every highlight, and over full cross-node GFM ranges, which require splitting inline formatting and substantially more mapping work.

**Considered options**: offsets into a normalized plain-text projection (renderer changes would silently move highlights); DOM ranges (break on re-render and differ per client); full GFM cross-node ranges (requires splitting inline formatting and a much larger mapping layer).

**Consequences**: selecting text across bold, italic or link boundaries is not annotatable in v1. Annotations over markdown escape sequences or HTML entities — where raw source and decoded text differ — are rejected rather than allowed to drift. Indented code renders but is not annotatable; fenced code is. Raw HTML is shown as text, images as alt text, and tables are not enabled. Supporting cross-node ranges later is an additive rendering change, but existing offsets stay valid because raw markdown is canonical.
