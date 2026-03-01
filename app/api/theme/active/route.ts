import { NextResponse } from 'next/server';

export async function GET() {
    // Return a default theme structure to satisfy the GlobalThemeProvider
    // and stop the 404 polling errors.
    return NextResponse.json({
        theme: {
            id: 'midnight-neon',
            name: 'Midnight Neon',
            type: 'dark',
            colors: {
                background: '#050510',
                surface: '#0a0f1a',
                primary: '#a855f7',
                secondary: '#3b82f6',
                accent: '#06b6d4',
                text: '#ffffff',
                textMuted: '#9ca3af',
                border: 'rgba(255,255,255,0.1)',
                error: '#ef4444',
                success: '#10b981',
                warning: '#f59e0b',
                canvas: {
                    bg: '#050510',
                    grid: 'rgba(168,85,247,0.1)'
                }
            },
            typography: {
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: {
                    small: '0.75rem',
                    base: '0.875rem',
                    large: '1rem',
                    title: '1.25rem'
                }
            },
            spacing: {
                unit: 4,
                container: '1rem'
            },
            borderRadius: {
                small: '0.25rem',
                base: '0.5rem',
                large: '1rem'
            },
            effects: {
                shadows: {
                    small: '0 2px 4px rgba(0,0,0,0.1)',
                    base: '0 4px 6px rgba(0,0,0,0.1)',
                    large: '0 10px 15px rgba(0,0,0,0.2)'
                },
                glow: {
                    primary: '0 0 15px rgba(168,85,247,0.3)',
                    secondary: '0 0 15px rgba(59,130,246,0.3)'
                }
            }
        }
    });
}
