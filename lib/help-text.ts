// Centralized help text registry for tooltips and the guide page.
// Keys are dot-path identifiers; values are plain-English explanations.
// No 'server-only' — importable by both server (guide page) and client (tooltip) components.

export const helpText: Record<string, string> = {
  // ── Config editor: top-level ──────────────────────────────────────────
  'config.name':
    'A display name for this configuration. Used in tables, exports, and batch run selection.',

  // ── World config ──────────────────────────────────────────────────────
  'config.world.agentCount':
    'Total number of agents in this world. More agents create richer dynamics but slower simulation. Typical range: 20–500.',

  'config.world.monolingualBilingualRatio':
    'Ratio of monolingual to bilingual agents. A ratio of 1.5 means 3 monolinguals for every 2 bilinguals. Higher values mean more monolinguals — which increases linguistic pressure on bilinguals to adopt the majority language. This is a key parameter for assimilation vs. segregation outcomes.',

  'config.world.topology':
    'The spatial structure agents inhabit. Lattice places agents on a 2D grid where they interact only with neighbors — this enables regional clustering and coarsening dynamics. Well-mixed lets any agent interact with any other (no spatial structure) — used as a control condition. Network uses a graph topology for realistic social structures.',

  'config.world.topology.width':
    'Width of the 2D lattice grid. Agents are placed randomly on the grid, so the grid should have more cells than agents. Default: 20.',

  'config.world.topology.height':
    'Height of the 2D lattice grid. Total cells = width x height. Must accommodate at least agentCount agents.',

  'config.world.topology.neighborhood':
    'Moore (8-cell) includes diagonal neighbors, giving each agent up to 8 interaction partners. Von Neumann (4-cell) uses only cardinal directions (up/down/left/right), limiting partners to 4. Moore creates denser local connectivity and faster spreading.',

  'config.world.topology.kind':
    'Network topology type. Small-world networks have short average path lengths and high clustering. Scale-free networks have hub nodes with many connections. User-supplied lets you define your own graph.',

  'config.world.referents':
    'The semantic categories (meanings) agents communicate about. Default: "yellow-like" and "red-like." More referents increase the complexity of vocabulary negotiation. Agents must agree on both the referent and the token for communication to succeed.',

  'config.world.vocabularySeed':
    'Initial token assignments by agent class, language, and referent. This JSON defines what each agent class "knows" at tick 0. Format: AgentClass -> Language -> Referent -> [{lexeme, initialWeight}]. All agents of the same class start with the same vocabulary.',

  // ── Interaction engine ────────────────────────────────────────────────
  'config.tickCount':
    'Total number of simulation ticks. Each tick, all agents get one activation (in the order determined by the scheduler). More ticks allow the system to reach equilibrium, but 5,000 is usually sufficient for small populations.',

  'config.seed':
    'Random number generator seed. The same seed with the same config produces byte-identical results. Change the seed to run independent replicates. Zero is a valid seed.',

  'config.deltaPositive':
    "Weight increment on successful communication (Δ⁺). When speaker and hearer agree on a token, both increase that token's weight by this amount. Higher values mean faster vocabulary convergence but less exploration. Default: 0.1.",

  'config.deltaNegative':
    'Weight penalty on failed communication (Δ⁻). When set to 0 (the minimal Naming Game), failed interactions have no penalty — agents simply retry with a different partner. Non-zero values cause losing tokens to decay, accelerating convergence but potentially trapping the system in suboptimal vocabularies.',

  'config.retryLimit':
    'Maximum partner-selection retries after a failed interaction, per speaker activation. With retryLimit=3, a speaker gets up to 4 attempts per tick. Higher values increase interaction density per tick.',

  'config.interactionProbability':
    'Probability that an activated agent attempts an interaction. At 1.0, every agent interacts every tick. At 0.5, each agent skips about half of their turns. Lower values create sparser, slower dynamics — useful for modeling intermittent communication.',

  'config.sampleInterval':
    'Ticks between metric snapshots. At sampleInterval=10, metrics are recorded every 10th tick. Lower values give finer-grained time series but use more memory. Must be ≤ tickCount.',

  'config.interactionMemorySize':
    'Maximum number of past interactions stored per agent for the preferential attachment feature. Larger memory means agents consider more interaction history when choosing partners. Default: 50.',

  'config.weightUpdateRule':
    'How token weights are updated. "Additive" directly adds Δ⁺ or subtracts Δ⁻ — weights can grow without bound. "L1-normalized" renormalizes weights after each update so all tokens for a (language, referent) pair sum to 1 — this keeps weights bounded and turns the dynamics into a competition for probability mass.',

  'config.schedulerMode':
    'Agent activation order each tick. "Random" shuffles agents each tick (default, recommended). "Sequential" activates agents in fixed ID order — useful for debugging. "Priority" is a placeholder for future activation-rate weighting.',

  // ── Classification thresholds ─────────────────────────────────────────
  'config.classificationThresholds':
    "Thresholds used to classify a completed run as assimilated, segregated, mixed, or inconclusive. Based on the final tick's assimilation and segregation indices.",

  'config.classificationThresholds.assimilationHigh':
    'Alpha (α): assimilation index must exceed this for the run to be classified as "assimilated." Higher α requires stronger L2 adoption among immigrants. Default: 0.7.',

  'config.classificationThresholds.segregationLow':
    'Beta (β): segregation index must be below this for the run to be classified as "assimilated." Default: 0.3.',

  'config.classificationThresholds.assimilationLow':
    'Gamma (γ): assimilation index must be below this for the run to be classified as "segregated." Default: 0.3.',

  'config.classificationThresholds.segregationHigh':
    'Delta (δ): segregation index must exceed this for the run to be classified as "segregated." Default: 0.7.',

  // ── Convergence ───────────────────────────────────────────────────────
  'config.convergence.consensusWindowTicks':
    'Number of consecutive ticks the distinct-token count (Nw) must remain stable to declare consensus reached. Longer windows require more sustained stability. Default: 100.',

  // ── Language policies ─────────────────────────────────────────────────
  'config.languagePolicies':
    'Rules governing which language a speaker uses with each hearer class. Most are fixed (e.g., monolinguals always use their language). "Configurable" rules have adjustable L1/L2 bias — higher L1 bias means bilinguals prefer L1 more often, which promotes segregation. Equal bias (0.5) gives an unbiased coin flip.',

  // ── Success policy (post-v1, step 33) ─────────────────────────────────
  'config.successPolicy.kind':
    "Communication success rule. Deterministic (default): success requires the hearer to know the speaker's exact token for the same referent — sharp binary outcome. Gaussian: success is a smooth probability based on how similar the two agents' overall token-weight vectors are. Use deterministic for the canonical Naming Game; use Gaussian to study how vocabulary tolerance affects consensus.",

  'config.successPolicy.sigma':
    'Kernel width σ for the Gaussian success rule. The success probability is Ps = exp(-‖xi - xj‖² / (2σ²)). Higher σ widens the curve — agents tolerate larger linguistic differences before communication fails. Lower σ sharpens the curve — only very similar token weights succeed. Try sweeping σ from 0.1 to 5.0. Default: 1.0.',

  'config.successPolicy.gaussianTopK':
    "Number of top-weighted tokens used to build each agent's linguistic state vector for the Gaussian distance computation. Higher K = more nuanced similarity; lower K = focuses only on agents' dominant vocabulary. Default: 10 (matches preferential attachment).",

  // ── Linguistic migration (post-v1, step 34) ───────────────────────────
  'config.movement.enabled':
    'Enable Schelling-style spatial migration. After each successful interaction, agents on a lattice may step toward (high vocabulary similarity) or away from (low similarity) their interaction partner. Default: off (preserves canonical Naming Game). Lattice topology only — has no effect on well-mixed or network worlds.',

  'config.movement.attractThreshold':
    'Cosine-similarity threshold (between 0 and 1) above which agents move toward each other after an interaction, and below which they move away. Default: 0.5 — borderline indifferent. Lower thresholds (e.g. 0.3) make agents more eager to cluster; higher thresholds (e.g. 0.7) make them more eager to disperse.',

  'config.movement.attractStep':
    'Number of lattice cells to step toward the partner when the cosine similarity is above the attract threshold. Default: 1 (one cell). Set to 0 to disable attractive movement entirely.',

  'config.movement.repelStep':
    'Number of lattice cells to step away from the partner when the cosine similarity is below the attract threshold. Default: 2 (two cells, asymmetric — repulsion is stronger than attraction, matching the original PDF prescription). Set to 0 to disable repulsive movement.',

  'config.movement.collisionPolicy':
    'What happens when an agent tries to step into a cell already occupied. Swap: trade positions with the occupant (preserves cell-occupancy, produces clean Schelling dynamics). Skip: cancel the move (silently reduces migration rate when the lattice is dense). Default: swap.',

  'config.movement.topK':
    "Number of top-weighted tokens used to build each agent's vector for the cosine-similarity computation that drives movement decisions. Default: 10 (matches preferential attachment and the Gaussian success policy).",

  // ── Preferential attachment ───────────────────────────────────────────
  'config.preferentialAttachment.enabled':
    'When enabled, agents prefer to interact with partners whose vocabularies are similar to their own. This creates a feedback loop: agents who agree tend to keep agreeing, forming clusters. Disable to ablate this feature and compare outcomes.',

  'config.preferentialAttachment.warmUpTicks':
    'Ticks before preferential attachment engages. During warmup, partners are chosen uniformly at random, allowing agents to build diverse vocabularies before the similarity bias kicks in. Default: 100.',

  'config.preferentialAttachment.temperature':
    'Softmax temperature for partner-similarity weighting. Low temperature (e.g., 0.1) makes agents strongly prefer the most similar partner. High temperature (e.g., 10) approaches uniform random selection. Default: 1.0.',

  'config.preferentialAttachment.topK':
    'Number of highest-weighted tokens used to compute agent similarity. Higher K considers more of the vocabulary but is more computationally expensive. Default: 10.',

  'config.preferentialAttachment.similarityMetric':
    'Metric used to compare agent vocabularies. Cosine similarity measures the angle between token-weight vectors — 1.0 means identical preferences, 0.0 means completely different.',

  // ── Playground controls ───────────────────────────────────────────────
  'playground.seed':
    'RNG seed for this run. Same seed + same config = identical results. Click "Reseed & Reset" to apply. Zero is valid.',

  'playground.tickRate':
    'Simulation speed. At 1x, one tick is computed per animation frame. At 1000x, 1,000 ticks are batched per frame. Higher speeds skip visual updates for faster exploration.',

  'playground.deltaPositive':
    'Live-adjustable Δ⁺ (weight on success). Changes take effect immediately without resetting the run. See config help for full explanation.',

  'playground.deltaNegative':
    'Live-adjustable Δ⁻ (weight on failure). Changes take effect immediately without resetting the run.',

  'playground.interactionProbability':
    'Live-adjustable interaction probability. Changes take effect immediately without resetting the run.',

  'playground.prefAttachTemp':
    'Live-adjustable preferential attachment temperature. Changes take effect immediately without resetting the run.',

  'playground.gaussianSigma':
    "Live-adjustable Gaussian kernel width. Effective on the next tick — drag the slider during a running simulation to see the success-probability surface change in real time. Only applies when the success policy is set to 'gaussian' in the config editor.",

  'playground.attractThreshold':
    'Live-adjustable migration threshold. Effective on the next tick. Only applies when migration is enabled in the config editor. Try lowering the threshold mid-run to watch agents start clustering, or raising it to watch them disperse.',

  'playground.monoBiRatio':
    'Monolingual:bilingual ratio. Changing this requires a full reset because it changes the population composition. The ↺ symbol indicates this.',

  // ── Projections ───────────────────────────────────────────────────────
  'playground.projection.class':
    'Colors each agent by its class: W1-Mono, W1-Bi, W2-Native, or W2-Immigrant. Shows population structure — where monolinguals and bilinguals are located.',

  'playground.projection.dominantToken':
    'Colors each agent by its highest-weighted token. Shows vocabulary consensus — when large regions share a color, agents in those regions have converged on a common word.',

  'playground.projection.matchingRate':
    "Colors each agent by how well its top token matches its neighbors' top tokens (red = low agreement, green = high agreement). Shows the spatial pattern of consensus — green clusters are neighborhoods that agree, red boundaries are where different vocabularies meet.",

  // ── Network view ──────────────────────────────────────────────────────
  'playground.networkView':
    'The interaction network shows cumulative successful communication. Each node is an agent, each edge represents successful interactions (thicker = more frequent). Node colors represent Louvain community detection — groups of agents that interact more with each other than with outsiders. High modularity means strong community separation.',

  // ── Chart metrics ─────────────────────────────────────────────────────
  'chart.successRate':
    'Fraction of interactions per tick that succeeded (speaker and hearer agreed on the token). Starts low as agents have diverse vocabularies, then rises as consensus emerges. Separate lines for World 1 and World 2 let you compare convergence speed.',

  'chart.distinctTokens':
    'Count of unique (language, token) pairs with non-zero weight in the population (Nw). This is the canonical Naming Game observable. Starts at the total vocabulary size and drops toward 1 as agents converge on a single word per concept. If it stabilizes above 1, the system is metastable with coexisting vocabularies.',

  'chart.meanWeight':
    'Average token weight across all agents (positive weights only), per world. Rising mean weight indicates reinforcement of winning tokens. Diverging weights between worlds suggest different convergence rates.',

  'chart.largestCluster':
    'Size of the largest group of agents that agree on their top token for at least one referent. Grows as consensus spreads. When it equals the population size, full consensus is reached. Multiple large clusters indicate competing regional vocabularies.',

  'chart.modularity':
    'Louvain modularity (Q) of the cumulative interaction graph. Ranges from -1 to +1. Q > 0.3 is conventionally considered non-trivial community structure. High modularity means agents form distinct communication clusters — a sign of social segregation.',

  'chart.assimilation':
    'Among successful interactions between W2-Immigrants and W2-Natives, the fraction that used Language 2 (the host language). High values (near 1.0) mean immigrants are adopting L2 — assimilation. Low values mean they persist in L1 — segregation. Gaps in the line mean no qualifying interactions occurred that tick.',

  'chart.segregation':
    'Louvain modularity of the subgraph containing only W2-Immigrant nodes. High values indicate immigrants form a tight internal community with little cross-group communication — the "ghetto" effect. Low values indicate immigrants are dispersed across the broader interaction network.',

  'chart.spatialHomophily':
    'Mean cosine similarity between each agent and its lattice neighbors, averaged across the world. High = neighbors talk like each other (linguistic clustering, possibly driven by migration); low = neighbors talk differently (well-mixed vocabulary). Always computed (regardless of whether migration is enabled), so it serves as a baseline for ablation. NaN for non-lattice topologies — the line breaks at those ticks.',

  // ── Run summary ───────────────────────────────────────────────────────
  'run.classification':
    "Final outcome classification based on the last tick's assimilation and segregation indices compared to the configured thresholds (α, β, γ, δ). Assimilated: high assimilation + low segregation. Segregated: low assimilation + high segregation. Mixed: neither extreme. Inconclusive: insufficient qualifying interactions.",

  'run.convergence':
    'Whether the population reached a stable vocabulary state. Converged: distinct tokens (Nw) reached 1 and stayed there. Metastable: Nw stabilized above 1 (multiple coexisting vocabularies). Diverged: weights grew unbounded (usually a config error). Unresolved: run ended before stability.',

  'run.timeToConsensus':
    'The tick at which distinct tokens (Nw) stabilized for at least the configured consensus window. "Not reached" means Nw was still changing when the run ended. Earlier consensus indicates faster vocabulary agreement.',

  // ── Runs table ────────────────────────────────────────────────────────
  'runs.classification':
    "Run outcome: assimilated, segregated, mixed, or inconclusive. Based on the final tick's assimilation and segregation indices vs. configured thresholds.",

  'runs.duration':
    'Wall-clock time to complete the run. Useful for benchmarking and estimating batch run times.',

  // ── Batch fields ──────────────────────────────────────────────────────
  'batch.replicates':
    'Number of independent runs to execute. Each replicate uses a different seed (base seed + replicate index). More replicates give more statistical power for comparing outcomes across parameter settings.',

  'batch.baseSeed':
    'Seed for the first replicate. Subsequent replicates use baseSeed + 1, baseSeed + 2, etc. Use the same base seed across experiments to enable paired comparisons.',

  'batch.concurrency':
    "Number of parallel Web Workers. Higher concurrency finishes faster but uses more CPU cores. Capped at 8 or your device's core count, whichever is less.",

  'batch.totalTicks':
    "Total ticks per replicate. Overrides the config's tickCount for batch runs. Ensure this is long enough for the system to reach equilibrium.",
};
