---
okf_version: '0.2'
---

# Ada Lovelace PGM 0.4.0 Demo Knowledge Bundle

This self-contained OKF v0.2 Knowledge Bundle models Ada Lovelace, her documented network, and the later computing artifacts connected to her work.[^ada-overview] Its 46 Concept Nodes and their Relationships are the full PGM 0.4.0 Demo Vault, versioned directly with the specification.

All Concept-to-Concept Relationships are canonical typed PGM links with useful Properties where the source material supports them, except for exactly one documented OKF compatibility example: Horsley Towers' ordinary link back to the 1845 Event.

## Start here

1. Open [Ada Lovelace](people/ada-lovelace.md) first and use it as the center of the graph view.
2. Open the [Ada Lovelace Timeline](timeline/ada-lovelace-timeline.md) for a chronological route through the graph.
3. Browse the concepts below by people, work, places, and events.

The root `index.md` is the reserved OKF bundle document and is not a PGM Node. The 46 non-reserved Markdown documents below are the graph's Concept Nodes.

## Concepts by area

### People

* [Ada Lovelace](people/ada-lovelace.md) — central person and graph entry point
* [Lord Byron](people/lord-byron.md)
* [Anne Isabella Milbanke](people/anne-isabella-milbanke.md)
* [William King-Noel](people/william-king-noel.md)
* [Byron King-Noel, Viscount Ockham](people/byron-king-noel.md)
* [Anne Blunt, 15th Baroness Wentworth](people/anne-blunt.md)
* [Ralph King-Milbanke, 2nd Earl of Lovelace](people/ralph-king-milbanke.md)
* [Charles Babbage](people/charles-babbage.md)
* [Mary Somerville](people/mary-somerville.md)
* [Augustus De Morgan](people/augustus-de-morgan.md)
* [Luigi Menabrea](people/luigi-menabrea.md)
* [Charles Wheatstone](people/charles-wheatstone.md)
* [Andrew Crosse](people/andrew-crosse.md)

### Work

* [Analytical Engine](work/analytical-engine.md)
* [Menabrea translation and Notes A–G](work/menabrea-translation-and-notes.md)
* [Note G](work/note-g.md)
* [Ada programming language](work/ada-programming-language.md)

### Places

* [London](places/london.md)
* [Surrey](places/surrey.md)
* [Turin](places/turin.md)
* [Horsley Towers](places/horsley-towers.md)

### Events

#### Childhood and education

* [1815 — Ada Lovelace is born](events/1815-ada-born.md)
* [1816 — Ada's parents separate](events/1816-parents-separate.md)
* [1824 — Lord Byron dies](events/1824-lord-byron-dies.md)
* [1828 — Ada develops the Flyology project](events/1828-flyology-project.md)
* [1832 — Ada's mathematical studies emerge](events/1832-mathematical-studies-emerge.md)
* [1833 — Ada meets Charles Babbage](events/1833-ada-meets-babbage.md)
* [1833 — Ada sees the Difference Engine prototype](events/1833-difference-engine-demonstration.md)

#### Marriage, children, and title

* [1835 — Ada marries William King](events/1835-ada-marries-william-king.md)
* [1836 — Byron King-Noel is born](events/1836-byron-king-noel-born.md)
* [1837 — Anne Isabella King-Noel is born](events/1837-anne-isabella-born.md)
* [1838 — William becomes Earl of Lovelace](events/1838-william-becomes-earl-of-lovelace.md)
* [1839 — Ralph Gordon King-Noel is born](events/1839-ralph-gordon-born.md)

#### Analytical Engine and research

* [1840 — Babbage lectures in Turin](events/1840-babbage-turin-lecture.md)
* [1842 — Menabrea's paper is published](events/1842-menabrea-paper-published.md)
* [1842–1843 — Ada translates Menabrea's paper](events/1842-1843-ada-translates-menabrea.md)
* [1843 — The translation and Notes A–G are published](events/1843-notes-a-g-published.md)
* [1843 — Note G presents the Bernoulli-number procedure](events/1843-note-g-bernoulli-procedure.md)
* [1844 — Ada researches a mathematical model of the nervous system](events/1844-nervous-system-model-research.md)
* [1845 — Horsley Towers becomes the family's main home](events/1845-horsley-towers-main-home.md)
* [1851 — Ada mentions work connecting mathematics and music](events/1851-mathematics-and-music-work.md)
* [1852 — Ada Lovelace dies](events/1852-ada-dies.md)

#### Later computing history

* [1953 — Ada's Notes are republished](events/1953-notes-republished.md)
* [1979 — The Ada programming language is named](events/1979-ada-language-named.md)
* [1980 — The Ada reference manual is approved](events/1980-ada-reference-manual-approved.md)

### Timeline

* [Ada Lovelace Timeline](timeline/ada-lovelace-timeline.md) — one chronological entry point across all 24 Event concepts

## Evidence policy

Historical claims are attributed through OKF source IDs and Markdown footnotes. Every external evidence link points exclusively to a Wikipedia page or one of its sections. Ordinary links within this directory connect bundle concepts; PGM links additionally form the property graph.

## Validate or open the vault

From the repository root, run:

```sh
pgmark validate demo-vault
pgmark parse demo-vault --format json
```

Open the `demo-vault` directory directly as an Obsidian vault. Its local `.obsidian` workspace is deliberately ignored by Git. The versioned bundle contains no executable plugin, generated database, account, telemetry, or network dependency; Markdown remains the source of truth.

[^ada-overview]: [Wikipedia — Ada Lovelace](https://en.wikipedia.org/wiki/Ada_Lovelace)
