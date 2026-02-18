import { renderSoul } from '../soul';

describe('renderSoul', () => {
    it('renders complete markdown with all sections', () => {
        const soul = {
            name: 'Ernesto',
            emoji: '🤖',
            persona: 'A helpful AI assistant',
            tone: 'Professional and friendly',
            boundaries: 'Cannot access external systems',
        };

        const result = renderSoul(soul);

        expect(result).toBe(
            '# 🤖 Ernesto\n\n' +
            'A helpful AI assistant\n\n' +
            '**Tone:** Professional and friendly\n\n' +
            '**Boundaries:** Cannot access external systems'
        );
    });

    it('renders minimal soul without tone and boundaries', () => {
        const soul = {
            name: 'Simple Bot',
            persona: 'A basic assistant',
        };

        const result = renderSoul(soul);

        expect(result).toBe(
            '# Simple Bot\n\n' +
            'A basic assistant'
        );
    });

    it('includes emoji prefix in heading', () => {
        const soul = {
            name: 'Emoji Bot',
            emoji: '🎉',
            persona: 'A celebratory assistant',
        };

        const result = renderSoul(soul);

        expect(result).toContain('# 🎉 Emoji Bot');
    });
});
