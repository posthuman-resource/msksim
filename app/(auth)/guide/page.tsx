import { verifySession } from '@/lib/auth/dal';
import { helpText } from '@/lib/help-text';

export default async function GuidePage() {
  await verifySession();

  return (
    <div className="mx-auto flex max-w-6xl gap-12">
      {/* Sticky sidebar TOC */}
      <nav className="hidden lg:block sticky top-6 h-fit w-56 shrink-0 text-sm">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Guide</h2>
        <ul className="space-y-1.5 text-fg-muted">
          <li>
            <a href="#naming-game" className="hover:text-accent">
              What is the Naming Game?
            </a>
          </li>
          <li>
            <a href="#two-worlds" className="hover:text-accent">
              The Two Worlds
            </a>
          </li>
          <li>
            <a href="#interactions" className="hover:text-accent">
              How Interactions Work
            </a>
          </li>
          <li>
            <a href="#topology" className="hover:text-accent">
              Spatial Topology
            </a>
          </li>
          <li>
            <a href="#playground" className="hover:text-accent">
              Using the Playground
            </a>
          </li>
          <li>
            <a href="#config" className="hover:text-accent">
              Configuring Experiments
            </a>
          </li>
          <li>
            <a href="#batch" className="hover:text-accent">
              Batch Runs
            </a>
          </li>
          <li>
            <a href="#results" className="hover:text-accent">
              Understanding Results
            </a>
          </li>
          <li>
            <a href="#metrics" className="hover:text-accent">
              Metrics Reference
            </a>
          </li>
          <li>
            <a href="#gaussian" className="hover:text-accent">
              Gaussian Success Policy
            </a>
          </li>
          <li>
            <a href="#migration" className="hover:text-accent">
              Linguistic Migration
            </a>
          </li>
          <li>
            <a href="#glossary" className="hover:text-accent">
              Glossary
            </a>
          </li>
        </ul>
      </nav>

      {/* Main content */}
      <article className="min-w-0 flex-1 space-y-10 pb-16">
        {/* ── What is the Naming Game? ─────────────────────────── */}
        <section id="naming-game">
          <h1 className="font-serif text-2xl font-semibold text-fg mb-4">
            What is the Naming Game?
          </h1>
          <p className="text-sm text-fg leading-7">
            The <strong>Naming Game</strong> is an agent-based model that simulates how groups of
            agents develop shared vocabulary through repeated pairwise interactions. Instead of
            being taught words by a central authority, agents discover which words to use by trying
            them out with partners. If both agents agree on a word for a concept, they reinforce it;
            if they disagree, they try different partners.
          </p>
          <p className="mt-3 text-sm text-fg leading-7">
            This simulation extends the classic Naming Game to a{' '}
            <strong>two-world bilingual scenario</strong>: it asks how shared understanding emerges
            (or fails to emerge) when monolingual and bilingual populations interact under
            geographical and linguistic pressure. The core research question is:{' '}
            <em>
              How does the communication success of color terms emerge through linguistic pressure
              modulated by geographical location?
            </em>
          </p>
        </section>

        {/* ── The Two Worlds ───────────────────────────────────── */}
        <section id="two-worlds">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            The Two Worlds
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            The simulation runs two parallel, separate worlds. Each has its own spatial grid and
            populations:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-md border border-indigo-200 bg-accent-soft p-4">
              <h3 className="font-serif text-base font-semibold text-accent mb-2">
                World 1 (Home)
              </h3>
              <ul className="text-sm text-fg space-y-1 list-disc list-inside">
                <li>
                  <strong>W1-Mono</strong> (monolingual natives) &mdash; speak only Language 1 (L1).
                  Always use L1 when interacting.
                </li>
                <li>
                  <strong>W1-Bi</strong> (bilinguals) &mdash; speak both L1 and L2. Always use L1
                  when talking to monolinguals in this world.
                </li>
              </ul>
            </div>
            <div className="rounded-md border border-amber-200 bg-warn-bg p-4">
              <h3 className="font-serif text-base font-semibold text-warn mb-2">World 2 (Host)</h3>
              <ul className="text-sm text-fg space-y-1 list-disc list-inside">
                <li>
                  <strong>W2-Native</strong> (native hosts) &mdash; speak only Language 2 (L2).
                  Always use L2.
                </li>
                <li>
                  <strong>W2-Immigrant</strong> (bilingual immigrants) &mdash; speak both L1 and L2.
                  Use <em>both languages</em> when interacting &mdash; this is the source of
                  linguistic pressure.
                </li>
              </ul>
            </div>
          </div>
          <p className="mt-3 text-sm text-fg leading-7">
            The key dynamic: immigrants in World 2 face a choice. If they succeed with L2, they
            reinforce it and assimilate. If they fail, they retreat to L1 and may cluster with other
            immigrants &mdash; segregation.
          </p>
        </section>

        {/* ── How Interactions Work ────────────────────────────── */}
        <section id="interactions">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            How Interactions Work
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            Each simulation <strong>tick</strong>, every agent gets a chance to interact. The
            per-agent interaction follows these steps:
          </p>
          <ol className="text-sm text-fg space-y-2 list-decimal list-inside">
            <li>
              <strong>Partner selection.</strong> Pick a neighbor on the grid. Once preferential
              attachment warms up, agents prefer partners with similar vocabularies.
            </li>
            <li>
              <strong>Language selection.</strong> The speaker picks a language based on the
              language policy (who they&apos;re talking to determines which language they use).
            </li>
            <li>
              <strong>Referent selection.</strong> The speaker picks a concept to talk about (e.g.,
              &ldquo;the yellow-like color&rdquo;).
            </li>
            <li>
              <strong>Token utterance.</strong> The speaker picks a word for that concept, weighted
              by token weights. Higher-weight words are chosen more often.
            </li>
            <li>
              <strong>Guessing.</strong> The hearer checks if they know the same word for the same
              concept. If yes &mdash; <em>success</em>; both agents increase that word&apos;s weight
              by &Delta;&#x207A;. If no &mdash; <em>failure</em>; the speaker may retry with a
              different partner (up to the retry limit).
            </li>
          </ol>
          <p className="mt-3 text-sm text-fg leading-7">
            Over many ticks, successful words get reinforced and spread, while unsuccessful ones
            fade. This process is called <strong>convergence</strong> &mdash; the population moves
            toward a shared vocabulary.
          </p>
        </section>

        {/* ── Spatial Topology ─────────────────────────────────── */}
        <section id="topology">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Spatial Topology
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            The spatial structure agents inhabit fundamentally shapes outcomes. Three topology types
            are supported:
          </p>
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-surface p-4">
              <h3 className="font-serif text-base font-semibold text-fg">2D Lattice (default)</h3>
              <p className="text-sm text-fg-muted mt-1">
                Agents are fixed to grid cells and interact only with neighbors. This creates
                <strong> regional clusters</strong> through coarsening dynamics &mdash; local
                agreement spreads region by region. Consensus takes longer but produces rich
                intermediate states with multiple coexisting vocabularies. This is where
                assimilation vs. segregation becomes observable.
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <h3 className="font-serif text-base font-semibold text-fg">Well-Mixed (control)</h3>
              <p className="text-sm text-fg-muted mt-1">
                Every agent can interact with any other &mdash; no spatial structure. Always
                converges to a single vocabulary faster. Used as a{' '}
                <strong>control condition</strong> to prove the lattice matters: segregation cannot
                emerge without geography.
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <h3 className="font-serif text-base font-semibold text-fg">Network (future)</h3>
              <p className="text-sm text-fg-muted mt-1">
                Agents interact over a graph topology (small-world, scale-free). For studying
                realistic social structures. Placeholder in v1.
              </p>
            </div>
          </div>
        </section>

        {/* ── Using the Playground ────���────────────────────────── */}
        <section id="playground">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Using the Playground
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            The playground is the live interactive mode. You can start, pause, step through the
            simulation, and adjust parameters in real time.
          </p>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Transport Controls
          </h3>
          <p className="text-sm text-fg leading-7">
            <strong>Play/Pause</strong> runs the simulation continuously. <strong>Step</strong>{' '}
            advances one tick at a time. <strong>Reset</strong> restarts from tick 0 with the same
            seed and config. <strong>Speed</strong> (1x to 1000x) controls how many ticks are
            batched per animation frame.
          </p>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Lattice Projections
          </h3>
          <p className="text-sm text-fg leading-7 mb-2">Three ways to color the lattice grid:</p>
          <ul className="text-sm text-fg space-y-1 list-disc list-inside">
            <li>
              <strong>Class</strong> &mdash; {helpText['playground.projection.class']}
            </li>
            <li>
              <strong>Dominant Token</strong> &mdash;{' '}
              {helpText['playground.projection.dominantToken']}
            </li>
            <li>
              <strong>Matching Rate</strong> &mdash;{' '}
              {helpText['playground.projection.matchingRate']}
            </li>
          </ul>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Live-Adjustable Sliders
          </h3>
          <p className="text-sm text-fg leading-7">
            Four parameters can be adjusted without resetting: &Delta;&#x207A; (weight on success),
            &Delta;&#x207B; (weight on failure), interaction probability, and preferential
            attachment temperature. The mono:bi ratio slider requires a reset because it changes the
            population composition (indicated by the &#x21BA; symbol).
          </p>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Metrics Dashboard
          </h3>
          <p className="text-sm text-fg leading-7">
            Seven synchronized charts track key observables in real time. You can pin any chart to
            enlarge it, and adjust Y-axis scaling (auto, 0&ndash;1, or custom range). Hover over any
            chart to see synchronized crosshairs across all charts.
          </p>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">Network Graph</h3>
          <p className="text-sm text-fg leading-7">{helpText['playground.networkView']}</p>
        </section>

        {/* ── Configuring Experiments ─────────────────────────��── */}
        <section id="config">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Configuring Experiments
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            The Experiments page lets you create, edit, duplicate, import, and export experiment
            configurations. Each configuration defines the full parameter set for a simulation run.
          </p>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            World Configuration
          </h3>
          <p className="text-sm text-fg leading-7">
            Each world is configured independently with: <strong>agent count</strong> (population
            size), <strong>mono:bi ratio</strong> (language distribution), <strong>topology</strong>{' '}
            (spatial structure), <strong>referents</strong> (semantic categories), and
            <strong> vocabulary seed</strong> (initial token assignments). Look for the
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-border-strong text-[10px] font-bold mx-1">
              ?
            </span>
            icons next to each field for detailed explanations.
          </p>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Interaction Engine
          </h3>
          <p className="text-sm text-fg leading-7">
            Controls the core simulation mechanics: tick count, seed, weight update parameters
            (&Delta;&#x207A;/&Delta;&#x207B;), retry limit, interaction probability, snapshot
            interval, weight update rule, and scheduler mode.
          </p>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Advanced Sections
          </h3>
          <ul className="text-sm text-fg space-y-1 list-disc list-inside">
            <li>
              <strong>Classification thresholds</strong> &mdash; four thresholds (&alpha;, &beta;,
              &gamma;, &delta;) that determine how completed runs are classified as assimilated,
              segregated, mixed, or inconclusive.
            </li>
            <li>
              <strong>Convergence detection</strong> &mdash; how long the distinct token count must
              be stable to declare consensus reached.
            </li>
            <li>
              <strong>Language policies</strong> &mdash; rules for which language each agent class
              uses with each other class. Configurable rules have adjustable L1/L2 bias.
            </li>
            <li>
              <strong>Preferential attachment</strong> &mdash; whether agents prefer similar
              partners, with warmup period and temperature controls.
            </li>
          </ul>
        </section>

        {/* ── Batch Runs ──────────────────────���────────────────── */}
        <section id="batch">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Batch Runs
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            Batch runs execute multiple independent replicates of the same configuration with
            different seeds. This provides statistical power for comparing outcomes.
          </p>
          <ul className="text-sm text-fg space-y-1 list-disc list-inside">
            <li>
              <strong>Replicates</strong> &mdash; {helpText['batch.replicates']}
            </li>
            <li>
              <strong>Base seed</strong> &mdash; {helpText['batch.baseSeed']}
            </li>
            <li>
              <strong>Concurrency</strong> &mdash; {helpText['batch.concurrency']}
            </li>
            <li>
              <strong>Total ticks</strong> &mdash; {helpText['batch.totalTicks']}
            </li>
          </ul>
          <p className="mt-3 text-sm text-fg leading-7">
            Each completed replicate is persisted to the database and appears on the Runs page.
            Results can be exported as CSV (long format for R/pandas) or JSON.
          </p>
        </section>

        {/* ── Understanding Results ──────────────���─────────────── */}
        <section id="results">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Understanding Results
          </h2>
          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Run Classification
          </h3>
          <p className="text-sm text-fg leading-7 mb-2">
            After a run completes, it is classified based on the final tick&apos;s assimilation and
            segregation indices compared against the configured thresholds:
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border border-green-200 bg-success-bg p-2">
              <strong className="text-success">Assimilated</strong>
              <p className="text-fg-muted text-xs mt-1">
                High assimilation index + low segregation index. Immigrants adopted L2 and
                integrated with the host community.
              </p>
            </div>
            <div className="rounded-md border border-red-200 bg-danger-bg p-2">
              <strong className="text-danger">Segregated</strong>
              <p className="text-fg-muted text-xs mt-1">
                Low assimilation index + high segregation index. Immigrants maintained L1 and formed
                a separate community.
              </p>
            </div>
            <div className="rounded-md border border-amber-200 bg-warn-bg p-2">
              <strong className="text-warn">Mixed</strong>
              <p className="text-fg-muted text-xs mt-1">
                Neither extreme &mdash; partial integration with some clustering.
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface-muted p-2">
              <strong className="text-fg">Inconclusive</strong>
              <p className="text-fg-muted text-xs mt-1">
                Insufficient qualifying interactions to make a determination.
              </p>
            </div>
          </div>

          <h3 className="font-serif text-base font-semibold text-fg mt-4 mb-2">
            Convergence Status
          </h3>
          <ul className="text-sm text-fg space-y-1 list-disc list-inside">
            <li>
              <strong>Converged</strong> &mdash; distinct tokens (Nw) reached 1 and stayed there.
              True consensus: one word per concept.
            </li>
            <li>
              <strong>Metastable</strong> &mdash; Nw stabilized above 1. Multiple vocabularies
              coexist stably (common on lattices due to regional clusters).
            </li>
            <li>
              <strong>Diverged</strong> &mdash; weights grew unbounded. Usually indicates a
              configuration error.
            </li>
            <li>
              <strong>Unresolved</strong> &mdash; the run ended before the system reached stability.
              Try increasing tick count.
            </li>
          </ul>
        </section>

        {/* ── Metrics Reference ────────────────────────────────── */}
        <section id="metrics">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Metrics Reference
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            Seven metrics are tracked per tick and displayed as time-series charts. Each measures a
            different aspect of vocabulary dynamics and social structure.
          </p>
          <div className="space-y-3">
            <MetricEntry title="Communication Success Rate" helpKey="chart.successRate" />
            <MetricEntry title="Distinct Active Tokens (Nw)" helpKey="chart.distinctTokens" />
            <MetricEntry title="Mean Token Weight" helpKey="chart.meanWeight" />
            <MetricEntry title="Largest Cluster Size" helpKey="chart.largestCluster" />
            <MetricEntry title="Louvain Modularity" helpKey="chart.modularity" />
            <MetricEntry title="Assimilation Index" helpKey="chart.assimilation" />
            <MetricEntry title="Segregation Index" helpKey="chart.segregation" />
            <MetricEntry title="Spatial Homophily" helpKey="chart.spatialHomophily" />
          </div>
        </section>

        {/* ── Gaussian Success Policy (post-v1) ────────────────── */}
        <section id="gaussian">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Gaussian Success Policy
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            By default, communication succeeds only when the hearer already knows the
            <em> exact </em>
            token the speaker uttered for the same referent &mdash; a sharp binary outcome straight
            from the canonical Naming Game. The Gaussian success policy replaces that rule with a
            smooth probability based on how similar the speaker&apos;s and hearer&apos;s overall
            top-K token-weight vectors are:
          </p>
          <p className="text-sm text-fg leading-7 mb-3 font-mono bg-surface-muted border border-border rounded-md px-3 py-2">
            P<sub>s</sub>(i, j) = exp(&minus;&Vert;x<sub>i</sub> &minus; x<sub>j</sub>&Vert; &sup2;
            &nbsp;/&nbsp; (2&sigma;&sup2;))
          </p>
          <p className="text-sm text-fg leading-7 mb-3">
            Wider &sigma; makes the curve more forgiving &mdash; even agents with somewhat different
            vocabularies will sometimes succeed. Narrower &sigma; makes communication brittle
            &mdash; only near-identical agents reliably succeed. Use the deterministic policy for
            the canonical model; switch to Gaussian when the research question is about how
            <em> linguistic tolerance </em> shapes consensus dynamics.
          </p>
          <p className="text-sm text-fg leading-7 mb-3">
            <strong>Try this:</strong> set kind=Gaussian, &sigma;=1.0, run 200 ticks. Then sweep
            &sigma; from 0.1 to 5.0 with the same seed and compare consensus times. The
            deterministic baseline lives at the &sigma;&rarr;0 limit; the well-mixed limit at
            &sigma;&rarr;&infin;.
          </p>
          <p className="text-xs text-fg-subtle leading-relaxed">
            With kind=deterministic (the default), the engine consumes zero new RNG draws and runs
            bit-identically to pre-step-33 versions.
          </p>
        </section>

        {/* ── Linguistic Migration (post-v1) ───────────────────── */}
        <section id="migration">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Linguistic Migration
          </h2>
          <p className="text-sm text-fg leading-7 mb-3">
            Lattice-based segregation in the Naming Game usually emerges from
            <em> who talks to whom</em>. Linguistic migration adds a second mechanism inspired by
            Schelling&apos;s segregation model: after each successful interaction, an agent on a
            lattice may
            <strong> step toward </strong> a partner whose vocabulary is similar (cosine similarity
            &ge; <em>attractThreshold</em>) or
            <strong> step away from </strong> a partner whose vocabulary is dissimilar (cosine
            similarity &lt; <em>attractThreshold</em>). The two step counts are independent &mdash;
            the PDF-recommended defaults are 1 cell forward, 2 cells back, making repulsion stronger
            than attraction.
          </p>
          <p className="text-sm text-fg leading-7 mb-3">
            Lattice topology only &mdash; the engine gates movement on a topology
            <em> capability</em>, so well-mixed and network worlds simply ignore the setting. When
            an agent tries to step into an occupied cell, the
            <strong> collision policy </strong>
            decides what happens: <em>Swap</em> trades positions with the occupant (clean Schelling
            dynamics, conserves cell-occupancy); <em>Skip</em> cancels the move silently (reduces
            effective migration rate when the lattice is dense).
          </p>
          <p className="text-sm text-fg leading-7 mb-3">
            The new <strong>Spatial Homophily</strong> chart on the metrics dashboard tracks the
            mean cosine similarity between each agent and its lattice neighbors. Watch this rise as
            clusters form. The metric is computed every tick regardless of whether migration is on,
            so it doubles as the baseline observable for ablations.
          </p>
          <p className="text-sm text-fg leading-7 mb-3">
            <strong>Try this:</strong> enable migration with attractThreshold=0.5, run with movement
            disabled for comparison &mdash; both runs produce the
            <em> Spatial Homophily </em>
            metric, so you can see whether migration actively accelerates spatial clustering, or
            whether the topology was producing it deterministically already.
          </p>
          <p className="text-xs text-fg-subtle leading-relaxed">
            With movement.enabled=false (the default), the engine short-circuits the migration pass
            to a no-op and consumes zero new RNG draws &mdash; pre-step-34 runs remain
            bit-identical.
          </p>
        </section>

        {/* ── Glossary ─────────────────────────────────────────── */}
        <section id="glossary">
          <h2 className="font-serif text-xl font-semibold text-fg mb-3 mt-8 first:mt-0">
            Glossary
          </h2>
          <dl className="text-sm space-y-3">
            <GlossaryItem
              term="Agent"
              definition="An individual in the simulation. Each agent has a class, a position on the grid, and a vocabulary inventory."
            />
            <GlossaryItem
              term="Token / Lexeme"
              definition='A word (surface form), e.g., "yellow", "rouge". Tokens are arbitrary symbols — the simulation treats them as opaque identifiers.'
            />
            <GlossaryItem
              term="Referent"
              definition='A meaning or concept, e.g., "the yellow-like color category." Agents must agree on both the referent and the token for communication to succeed.'
            />
            <GlossaryItem
              term="Weight"
              definition="A non-negative number representing how strongly an agent prefers a particular token for a given referent. Increases on successful communication."
            />
            <GlossaryItem
              term="Inventory"
              definition="An agent's full vocabulary: a nested structure of Language -> Referent -> Token -> Weight."
            />
            <GlossaryItem
              term="Tick"
              definition="One time step. Each tick, all agents get one activation in the order determined by the scheduler."
            />
            <GlossaryItem
              term="Nw (Distinct Active Tokens)"
              definition="Count of unique tokens with non-zero weight in the population. The canonical Naming Game observable. Drops toward 1 as consensus emerges."
            />
            <GlossaryItem
              term="Convergence"
              definition="The process of a population moving toward a shared vocabulary. Measured by the stability of Nw over time."
            />
            <GlossaryItem
              term="Coarsening"
              definition="On lattices: regional clusters of agreement form and slowly compete at their boundaries. The mechanism by which consensus spreads spatially."
            />
            <GlossaryItem
              term="Assimilation"
              definition="Immigrants adopting the host language (L2) and integrating socially. Measured by the fraction of immigrant-native interactions in L2."
            />
            <GlossaryItem
              term="Segregation"
              definition="Immigrants maintaining their native language (L1) and clustering separately. Measured by the modularity of the immigrant subgraph."
            />
            <GlossaryItem
              term="Linguistic Pressure"
              definition="The constraint that bilinguals use both languages. Forces adaptation — immigrants must choose between L1 and L2 in each interaction."
            />
            <GlossaryItem
              term="Preferential Attachment"
              definition="A partner-selection bias where agents prefer to interact with others who have similar vocabularies. Creates feedback loops that amplify existing clusters."
            />
            <GlossaryItem
              term="Modularity (Louvain)"
              definition="A graph metric measuring community structure. Ranges from -1 to +1. Values above 0.3 indicate non-trivial clustering."
            />
            <GlossaryItem
              term="Seed"
              definition="Random number generator seed. Same seed + same config = identical results. Enables reproducible research."
            />
          </dl>
        </section>
      </article>
    </div>
  );
}

function MetricEntry({ title, helpKey }: { title: string; helpKey: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <h3 className="font-serif text-base font-semibold text-fg">{title}</h3>
      <p className="text-sm text-fg-muted mt-1">{helpText[helpKey]}</p>
    </div>
  );
}

function GlossaryItem({ term, definition }: { term: string; definition: string }) {
  return (
    <div>
      <dt className="font-medium text-fg">{term}</dt>
      <dd className="text-fg-muted mt-0.5 ml-4">{definition}</dd>
    </div>
  );
}
