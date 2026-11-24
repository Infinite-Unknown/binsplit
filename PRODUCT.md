# BinSplit: product context

**What it is.** A phone-first web app. Scan or type a product barcode; BinSplit splits the product into its packaging parts (bottle, cap, label, seal, carton) and tells you which bin each part goes in under your area's official sorting rules, with the source for every rule.

**Who uses it.** A household member standing at the bin (kitchen, apartment bin room, recycling cage) holding an empty product, phone in the other hand. Usually daylight or bright indoor light. They want one answer per part in seconds, not an essay.

**Job to be done.** "I have this empty thing. Which parts go where, here?" Secondary: settle a doubt ("does the cap go with the bottle?"), and trust the answer (show the official source).

**Surface mode.** Operate. One task, done often, fast. The first screen also has to convince a first-time visitor (and a hackathon judge) in 10 seconds, so it leads with one clear action.

**Product truths that design must respect.**
- Every bin answer comes from a fetched official source (SWCorp Malaysia, NEA Singapore). Show the source; never imply more authority than it has.
- Data is crowd-sourced (Open Food Facts) and sometimes conflicting. Confidence and "the sources disagree, which is it?" are first-class UI, not error states.
- "Not covered by this area's rules" is an honest answer and must look deliberate, not broken.
- Works offline for products already looked up; no account, no server.

**Tone.** Plain, calm, practical. Short sentences. Local bin names shown next to English (Kertas, Plastik, Lain-lain, Sisa baki).

**Assumptions** (no interview was possible in this run; inferred from the build brief): light theme only, from the use scene (bright rooms, outdoors bin areas); English UI with Malay bin names; Malaysia pack is the default because the team is in Malaysia.
