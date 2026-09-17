export interface Simulation {
    apiOrigin: string
    webOrigin: string
    appUrl: string
    mediaDir: string
    simDir: string
    credentials: { username: string; password: string }
    stop: () => Promise<void>
}

export function startSimulation(options?: {
    dir?: string
    apiPort?: number
    webPort?: number
    fresh?: boolean
    quiet?: boolean
}): Promise<Simulation>
