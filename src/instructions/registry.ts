import { InstructionContent, InstructionContext } from './types';
import { renderInstructionTemplate } from './template';

/**
 * Registry for managing instruction content
 * */
export class InstructionRegistry {
    private content: InstructionContent;

    constructor(content: InstructionContent) {
        this.content = content;
    }

    /**
     * Render instructions with context
     */
    render(context: InstructionContext): string {
        return renderInstructionTemplate(this.content.instructions, context);
    }

    /**
     * Render ask tool description with context
     */
    renderAskTool(context: InstructionContext): string {
        return renderInstructionTemplate(this.content.askTool, context);
    }

    /**
     * Render get tool description with context
     */
    renderGetTool(context: InstructionContext): string {
        return renderInstructionTemplate(this.content.getTool, context);
    }
}
