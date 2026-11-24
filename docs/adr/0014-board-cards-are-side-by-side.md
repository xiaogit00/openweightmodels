# Board cards preview their Models side by side

Board cards used to preview each Model's reply in full-width stacked rows, because `design_handoff_redesign` judged side-by-side too cramped at Board widths. `design_handoff_weight_class_board` reverses that: the card previews Base and Challenger in two columns, even at the Board grid's 320px minimum, and the stacked layout is removed rather than kept as an unused variant.

**Considered options**: keeping stacked as the default and treating side-by-side as an option (rejected: two layouts to maintain and no consumer for the second); widening the Board grid so a side-by-side card gets more room (rejected: fewer cards per row and a larger minimum card). The reversal is accepted because the card's job is comparison at a glance, and the weight-class matchup line reads as a statement about the two columns above it.

**Consequences**: `ComparisonCardView` changes shape and loses the stacked markup; its visual snapshots regenerate; the challenger's `+N more` Models remain in the Challenger column; truncated names and the matchup tag must hold at 320px.
