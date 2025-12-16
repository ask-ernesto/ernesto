/**
 * Runtime context for instruction templating
 */
export interface InstructionContext {
	// Stats
	domainCount: number;
	resourceCount: number;
	routeCount: number;

	// Domain info
	domains: string[];

	// Optional: Source freshness
	staleSources?: string[];

	// Extensible for future needs
	[key: string]: any;
}

/**
 * Template function that receives context and returns string
 */
export type InstructionTemplate = (context: InstructionContext) => string;

/**
 * All instruction content for an Ernesto instance
 */
export interface InstructionContent {
	/**
	 * Master instructions for Ernesto
	 * Used for MCP server instructions field and documentation
	 * Explains why use Ernesto, two-step workflow, routes vs resources
	 */
	instructions: InstructionTemplate;

	/**
	 * Description of ask() tool
	 * Shown in MCP tool registry
	 */
	askTool: InstructionTemplate;

	/**
	 * Description of get() tool
	 * Shown in MCP tool registry
	 */
	getTool: InstructionTemplate;
}

/**
 * Provider interface for loading instructions
 */
export interface InstructionProvider {
	getInstructions(): InstructionContent;
}
