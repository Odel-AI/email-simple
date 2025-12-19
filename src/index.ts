/**
 * Email Module
 *
 * Sends transactional emails via Resend API.
 * Includes abuse prevention with user tracking and report links.
 */

import { McpServer } from '@odel/module-sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@odel/module-sdk/server/webStandardStreamableHttp.js';
import {
	SuccessResponseSchema,
	extractToolContext,
	type ToolContext,
	type RequestBodyWithContext
} from '@odel/module-sdk/odel';
import type { CallToolResult } from '@odel/module-sdk/types.js';
import { z } from 'zod';

// Environment bindings
interface Env {
	RESEND_API_KEY: string;
}

// Input schema
const SendEmailInputSchema = {
	to: z.string().email().describe('Recipient email address'),
	subject_suffix: z.string().describe('Email subject suffix (will be prefixed with "Odel has sent: ")'),
	text: z.string().describe('Plain text email body'),
	html: z.string().optional().describe('Optional HTML email body for rich formatting')
};

// Output schema
const SendEmailOutputSchema = SuccessResponseSchema(
	z.object({
		id: z.string().describe('Resend email ID for tracking'),
		to: z.string().describe('Confirmed recipient email address')
	})
);

type SendEmailInput = z.infer<z.ZodObject<typeof SendEmailInputSchema>>;
type SendEmailOutput = z.infer<typeof SendEmailOutputSchema>;

/**
 * Generate UUID v4
 */
function generateUUID(): string {
	return crypto.randomUUID();
}

/**
 * Build email footer with user attribution and abuse report link
 */
function buildFooter(userId: string, displayName: string, trackingId: string): { text: string; html: string } {
	const reportUrl = `https://odel.app/report-abuse?id=${trackingId}`;

	const text = `

───────────────────────────────
Sent on behalf of: ${displayName} (ID: ${userId})
This is an automated email - please do not reply to this address.
Report abuse: ${reportUrl}
`;

	const html = `
<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
<p style="font-size: 12px; color: #6b7280; margin: 0;">
	<strong>Sent on behalf of:</strong> ${escapeHtml(displayName)} (ID: ${userId})<br>
	<em>This is an automated email - please do not reply to this address.</em><br>
	<a href="${reportUrl}" style="color: #3b82f6; text-decoration: none;">Report abuse</a>
</p>
`;

	return { text, html };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Send email via Resend API
 */
async function sendViaResend(
	apiKey: string,
	from: string,
	to: string,
	subject: string,
	text: string,
	html?: string
): Promise<{ id: string }> {
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from,
			to,
			subject,
			text,
			...(html && { html })
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Resend API error: ${response.status} - ${error}`);
	}

	const result = await response.json() as { id: string };
	return result;
}

/**
 * Create the MCP server instance
 */
function createServer() {
	const server = new McpServer({
		name: 'email-simple',
		version: '0.0.2'
	});

	return server;
}

/**
 * Create the send_email tool handler
 */
function createSendEmailHandler(context: ToolContext<Env>) {
	// Extract context values with fallbacks (defensive against undefined)
	const userId = context?.userId || 'anonymous';
	const displayName = context?.displayName || 'Anonymous User';

	return async (input: SendEmailInput): Promise<SendEmailOutput> => {
		try {
			// Validate required input fields
			if (!input.to || !input.subject_suffix || !input.text) {
				return {
					success: false as const,
					error: 'Missing required fields: to, subject_suffix, and text are required'
				};
			}

			// Generate tracking UUID
			const trackingId = generateUUID();

			// Build footer with user attribution
			const footer = buildFooter(
				userId,
				displayName,
				trackingId
			);

			// Append footer to email content
			const fullText = input.text + footer.text;
			const fullHtml = input.html
				? input.html + footer.html
				: undefined;

			// Construct subject
			const subject = `Odel has sent: ${input.subject_suffix}`;

			// Send via Resend
			const result = await sendViaResend(
				context.env.RESEND_API_KEY,
				'Odel Assistant <noreply@mail.odel.app>',
				input.to,
				subject,
				fullText,
				fullHtml
			);

			return {
				success: true as const,
				id: result.id,
				to: input.to
			};

		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false as const,
				error: `Failed to send email: ${errorMessage}`
			};
		}
	};
}

// Create transport for stateless HTTP requests
const transport = new WebStandardStreamableHTTPServerTransport();

// Cloudflare Worker export
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Health check endpoint
		if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
			return new Response(JSON.stringify({ status: 'ok' }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Only accept POST for MCP
		if (request.method !== 'POST') {
			return new Response(JSON.stringify({
				jsonrpc: '2.0',
				error: { code: -32000, message: 'Method not allowed' },
				id: null
			}), {
				status: 405,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		try {
			// Parse the request body to extract context
			const body = await request.json() as RequestBodyWithContext;
			const context = extractToolContext(body, env);

			// Create a fresh server for each request (stateless)
			const server = createServer();

			// Register the send_email tool with context-aware handler
			const handler = createSendEmailHandler(context);
			server.registerTool(
				'send_email',
				{
					description: 'Send an email to a recipient with optional HTML formatting',
					inputSchema: SendEmailInputSchema,
					outputSchema: SendEmailOutputSchema
				},
				async (args): Promise<CallToolResult> => {
					const result = await handler(args as SendEmailInput);
					return {
						content: [{ type: 'text', text: JSON.stringify(result) }],
						structuredContent: result
					};
				}
			);

			// Connect and handle the request
			await server.connect(transport);

			// Reconstruct the request with the parsed body for the transport
			const newRequest = new Request(request.url, {
				method: request.method,
				headers: request.headers,
				body: JSON.stringify(body)
			});

			return transport.handleRequest(newRequest);
		} catch (error) {
			console.error('Error handling MCP request:', error);
			return new Response(JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32603,
					message: 'Internal server error'
				},
				id: null
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}
};
