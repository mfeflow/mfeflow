import { withBase } from '@rspress/core/runtime';
import { CopyCommand } from './CopyCommand';
import {
  CHANGELOG_URL,
  DESCRIPTION,
  DOCUMENTED_FEATURES,
  FEATURE_GROUPS,
  GUARDRAILS,
  INSTALL_COMMAND,
  NPM_URL,
  REGISTRY_CARDS,
  REPO_URL,
  STATS,
  STEPS,
  VERSION,
} from './content';
import './home.css';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: 'mfeflow',
  description: DESCRIPTION,
  license: 'https://opensource.org/licenses/MIT',
  codeRepository: REPO_URL,
  programmingLanguage: 'TypeScript',
};

function SectionHead({
  id,
  kicker,
  title,
  sub,
}: {
  id: string;
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <header className="mf-head">
      <p className="mf-kicker">{kicker}</p>
      <h2 id={id}>{title}</h2>
      {sub && <p className="mf-sub">{sub}</p>}
    </header>
  );
}

export function Home() {
  return (
    <div className="mf-home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="mf-hero mf-wrap" aria-labelledby="mf-title">
        <div className="mf-hero__copy">
          <p className="mf-pill">
            <span className="mf-dot" aria-hidden="true" />
            {VERSION} ON NPM · MIT
          </p>
          <h1 id="mf-title">
            One command.
            <br />
            <span className="mf-flow">Every remote.</span>
            <br />
            Pick only what you need.
          </h1>
          <p className="mf-lede">
            The React micro-frontend boilerplate that keeps going after day one. A shell and remotes
            on Module Federation 2.0 and Rsbuild, then typed env, GTM with Consent Mode,
            OpenTelemetry and 18 more features, added when you need them.
          </p>
          <div className="mf-cta">
            <CopyCommand command={INSTALL_COMMAND} />
            <a className="mf-btn" href={withBase('/guide/quickstart')}>
              Read the docs
            </a>
          </div>
          <p className="mf-facts">TypeScript · Rsbuild 2 · pnpm · Turborepo · oxlint</p>
        </div>

        <figure className="mf-term" aria-label="Terminal example">
          <div className="mf-term__bar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>~/my-app</span>
          </div>
          <pre className="mf-term__body">
            <code>
              <span className="mf-p">$</span> npm create mfeflow@latest my-app{'\n'}
              <span className="mf-ok">✓</span> shell + catalog + cart, ready in 5.3 s{'\n'}
              <span className="mf-p">$</span> pnpm mfeflow dev{'\n'}
              {'  '}
              <span className="mf-soft">shell</span> :4300 <span className="mf-soft">catalog</span>{' '}
              :4311 <span className="mf-soft">cart</span> :4312{'\n'}
              <span className="mf-p">$</span> pnpm mfeflow doctor{'\n'}
              <span className="mf-ok">✓</span> one React · one tracer · one tag manager
            </code>
          </pre>
          <dl className="mf-term__rows">
            <div>
              <dt className="mf-tag mf-tag--ok">ADD</dt>
              <dd>
                <code>mfeflow add env-t3</code> <span>typed env, shell + remotes</span>
              </dd>
            </div>
            <div>
              <dt className="mf-tag mf-tag--warn">BUDGET</dt>
              <dd>
                <code>shell +32 KB max</code> <span>each remote +10 KB, in CI</span>
              </dd>
            </div>
          </dl>
        </figure>
      </section>

      <section className="mf-wrap" aria-label="Proof">
        <ul className="mf-grid mf-grid--4 mf-list">
          {STATS.map((s) => (
            <li key={s.value} className="mf-card">
              <p className="mf-stat">{s.value}</p>
              <p className="mf-label">{s.label}</p>
              <p className="mf-meta">{s.source}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mf-band" aria-labelledby="mf-features">
        <div className="mf-wrap">
          <SectionHead
            id="mf-features"
            kicker="FEATURES"
            title="Pick only what you need."
            sub="Code you own is copied into your project. Logic that needs fixes is installed as a package and upgraded with migrations. Third-party features are declarative and never run code."
          />
          <div className="mf-grid mf-grid--4 mf-groups">
            {FEATURE_GROUPS.map((g) => (
              <div key={g.title} className="mf-card">
                <h3>{g.title}</h3>
                <ul className="mf-chips mf-list">
                  {g.features.map((f) => (
                    <li key={f}>
                      {DOCUMENTED_FEATURES.includes(f) ? (
                        <a className="mf-chip" href={withBase(`/features/${f}`)}>
                          {f}
                        </a>
                      ) : (
                        <span className="mf-chip">{f}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mf-addline">
            <code className="mf-soft">$ pnpm mfeflow add telemetry-otel analytics-gtm</code>{' '}
            <span className="mf-meta-inline">
              # shows the plan, then applies it atomically (--dry-run for the diff)
            </span>
          </p>
        </div>
      </section>

      <section className="mf-band" aria-labelledby="mf-how">
        <div className="mf-wrap">
          <SectionHead
            id="mf-how"
            kicker="HOW IT WORKS"
            title="From empty folder to a running platform."
          />
          <ol className="mf-grid mf-grid--4 mf-list">
            {STEPS.map((s) => (
              <li key={s.n} className="mf-card">
                <p className="mf-num">{s.n}</p>
                <h3>{s.title}</h3>
                <code className="mf-codebox">{s.code}</code>
                <p className="mf-body">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mf-band" aria-labelledby="mf-teams">
        <div className="mf-wrap">
          <SectionHead
            id="mf-teams"
            kicker="FOR MANY TEAMS"
            title="Many teams, one platform that holds."
            sub="The parts that break micro-frontends in year two are checked from day one."
          />
          <ul className="mf-grid mf-grid--4 mf-list">
            {GUARDRAILS.map((g) => (
              <li key={g.title} className="mf-card">
                <h3>{g.title}</h3>
                <p className="mf-body">{g.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mf-band" aria-labelledby="mf-registry">
        <div className="mf-wrap">
          <SectionHead
            id="mf-registry"
            kicker="IN PROGRESS · PHASE 05"
            title="Roll back by pointer, not by rebuild."
            sub="Remotes are built once and stored by version. Deploy, promote and roll back will move a pointer in the registry index, on any static host or a small server with percentage rollouts. This is being built now; the docs will say when it ships."
          />
          <ul className="mf-grid mf-grid--3 mf-list">
            {REGISTRY_CARDS.map((c) => (
              <li key={c.name} className="mf-card">
                <code className={c.accent ? 'mf-amber mf-reg' : 'mf-reg'}>{c.name}</code>
                <p className="mf-meta">{c.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mf-band mf-final" aria-labelledby="mf-final">
        <div className="mf-wrap">
          <h2 id="mf-final">Start with one command.</h2>
          <CopyCommand command={INSTALL_COMMAND} />
        </div>
      </section>

      <footer className="mf-foot">
        <div className="mf-wrap mf-foot__in">
          <p>MIT licensed · built in the open</p>
          <nav aria-label="Footer">
            <a href={withBase('/guide/quickstart')}>Docs</a>
            <a href={REPO_URL}>GitHub</a>
            <a href={NPM_URL}>npm</a>
            <a href={CHANGELOG_URL}>Changelog</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
