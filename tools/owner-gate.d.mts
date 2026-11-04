import type { IncomingMessage, ServerResponse } from 'node:http';
export function ownerCookie(password: string, now?: number): string;
export function ownerAuthorized(cookie: string | undefined, password: string, now?: number): boolean;
export function ownerGate(password?: string): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
export function rackPlugin(): { name: string; configureServer(server: any): void; configurePreviewServer(server: any): void };
