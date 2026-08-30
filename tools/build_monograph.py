#!/usr/bin/env python3
"""Build the single-file Rivet monograph from the docs/ corpus.

Reproducible: the same corpus + code produces byte-identical output.

Usage:
  python tools/build_monograph.py --docs docs --out site/index.html
"""
import argparse
import html
import re
import sys
from pathlib import Path
from bs4 import BeautifulSoup
import markdown

NAMES = [
    '01_RIVET_IDENTITY_AND_EVIDENCE_LABELS.md',
    '02_ABSTRACT.md',
    '03_RESEARCH_QUESTION.md',
    '04_ONTOLOGICAL_AUDIT.md',
    '05_RIVET_CONSTITUTION.md',
    '06_SYSTEM_THESIS.md',
    'HIGH_LEVEL_ARCHITECTURE.md',
    'INTERACTION_MODEL.md',
    'RESPONSIBILITY_MATRIX.md',
    'NOESIS_SPEC.md',
    'COGNITIVE_VIEW_COMPILER.md',
    'ACCP_SPEC.md',
    'PRAXIS_SPEC.md',
    'HEPHAESTUS_SPEC.md',
    'GOAL_COMPILER_AND_OBLIGATIONS.md',
    'TASK_AND_OBLIGATION_GRAPH.md',
    'ADAPTIVE_PROJECT_INDUCTION.md',
    'GENERALIST_CONTROL_PLANE.md',
    'PROJECT_GRAPH.md',
    'CAPABILITY_GRAPH.md',
    'ARTIFACT_OBSERVATION_TASK_COMPILER.md',
    'MODEL_INVOCATION_GATE.md',
    'TOKEN_AND_COMPUTE_ARCHITECTURE.md',
    'COGNITIVE_VIEW_POLICY.md',
    'STABLE_KNOWLEDGE_ARTIFACTS.md',
    'SEMANTIC_CODE_OPERATIONS.md',
    'PARALLELISM_AND_SCHEDULING.md',
    'WORKTREE_AND_MERGE_MODEL.md',
    'RESOURCE_ISOLATION.md',
    'PROJECT_TRUST_AND_INJECTION_BOUNDARY.md',
    'BUN_REWRITE_CASE_STUDY.md',
    'INDUSTRY_PRECEDENT_AUDIT.md',
    'ACADEMIC_LITERATURE_AUDIT.md',
    'NOVELTY_AUDIT.md',
    'PREMISE_AUDIT.md',
    'BENCHMARK_CONSTITUTION.md',
    'FLAGSHIP_EVALUATION_V8.md',
    'METRICS_AND_ACCOUNTING.md',
    'EXPERIMENTAL_LADDER.md',
    'TYPED_RUNTIME_CONTRACTS.md',
    'CONTEXT_ARCHITECTURE.md',
    'PATCH_AND_CONCURRENCY_SEMANTICS.md',
    'PROCESS_LEVEL_ERROR_ATTRIBUTION.md',
    'SECURITY_AND_TRUST_MODEL.md',
    'CONSTITUTIONAL_INVARIANT_TEST_SUITE.md',
    'TECHNICAL_ARCHITECTURE_V03.md',
    'IMPLEMENTATION_LAYOUT.md',
    'ADAPTER_STRATEGY.md',
    'DECISION_REGISTER.md',
    'OPEN_QUESTIONS.md',
    'ROADMAP.md',
    'RESEARCH_FAILURE_CONDITIONS.md',
    'SOURCE_MAP_AND_READING_LIST.md',
    'INTERNAL_SOURCE_LINEAGE.md',
    'GLOSSARY.md',
    'FINAL_RESEARCH_POSITION.md',
    'CHANGELOG.md',
]


def find_file(docs_dir: Path, name: str) -> Path | None:
    hits = list(docs_dir.rglob(name))
    return hits[0] if hits else None


def slugify(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r'[\'’"“”`]', '', slug)
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    return slug.strip('-')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--docs', default='docs', help='corpus directory (default: docs)')
    ap.add_argument('--out', default='site/index.html', help='output HTML path (default: site/index.html)')
    ap.add_argument('--head', default='tools/heads/head.html', help='head template (default: tools/heads/head.html)')
    args = ap.parse_args()

    docs_dir = Path(args.docs)
    head_path = Path(args.head)
    if not head_path.exists():
        print(f'error: head template {head_path} not found', file=sys.stderr)
        sys.exit(1)

    head = head_path.read_text(encoding='utf-8')

    sections_html = []
    toc_items = []

    for name in NAMES:
        p = find_file(docs_dir, name)
        if p is None:
            print(f'warning: {name} not found under {docs_dir} — skipped', file=sys.stderr)
            continue

        raw_text = p.read_text(encoding='utf-8')

        # Convert GitHub callouts to status div
        raw_text = re.sub(
            r'>\s*\[!NOTE\]\s*\n((?:>.*\n?)+)',
            lambda m: '<div class="status">' + re.sub(r'^>\s?', '', m.group(1), flags=re.MULTILINE).strip() + '</div>\n',
            raw_text
        )

        if p.suffix == '.yaml':
            html_body = '<pre>' + html.escape(raw_text) + '</pre>'
            soup = BeautifulSoup(html_body, 'html.parser')
            title = p.stem.replace('_', ' ')
            sec_id = 'sec-' + slugify(title)
            h1 = soup.new_tag('h1', id=sec_id)
            h1.string = title
            soup.insert(0, h1)
        else:
            html_body = markdown.markdown(
                raw_text,
                extensions=['tables', 'fenced_code', 'sane_lists', 'toc'],
                output_format='html5',
            )
            soup = BeautifulSoup(html_body, 'html.parser')

        # Process headers to add IDs and anchor links
        for header in soup.find_all(['h1', 'h2', 'h3']):
            raw_header_title = header.get_text().strip()
            if not header.get('id'):
                header['id'] = slugify(raw_header_title)
            h_id = header['id']

            # Add anchor link
            if not header.find('a', class_='anchor'):
                anchor = soup.new_tag('a', href=f'#{h_id}')
                anchor['class'] = 'anchor'
                anchor.string = '¶'
                header.append(anchor)

            # Record TOC items for H1 and H2
            if header.name == 'h1':
                toc_items.append(f'<li class="toc-h1"><a href="#{h_id}">{html.escape(raw_header_title)}</a></li>')
            elif header.name == 'h2':
                toc_items.append(f'<li class="toc-h2"><a href="#{h_id}">{html.escape(raw_header_title)}</a></li>')

        sections_html.append(str(soup))

    toc_html = '<nav id="toc"><h2>Contents</h2><ul>' + '\n'.join(toc_items) + '</ul></nav>'
    main_content = '<main>\n' + '\n'.join(sections_html) + '\n</main>'
    footer = '<footer><strong>Rivet Research Monograph v0.3.</strong> This document distinguishes external precedent, project design, inference, invariant and open questions. Architectural and technical choices remain provisional until executable evaluation supports them.<p>Research Draft 0.3 · technical implementation profile added on top of v0.2; research body retained unless explicitly amended by the changelog.</p></footer>\n<a class="backtop" href="#top">↑ TOP</a>\n</body></html>\n'

    document = head + '\n' + toc_html + '\n' + main_content + '\n' + footer

    # Convert remaining local .md links to anchor links if applicable
    document = re.sub(r'<a href="[^"]*?([A-Za-z0-9_-]+)\.md">([^<]+)</a>', r'<a href="#\1">\2</a>', document)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(document, encoding='utf-8')
    print(f'Successfully wrote {out_path} (sections={len(sections_html)}, words={len(document.split())})')


if __name__ == '__main__':
    main()
