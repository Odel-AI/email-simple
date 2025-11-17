/**
 * Email Module
 *
 * Sends transactional emails via Resend API.
 * Includes abuse prevention with user tracking and report links.
 */

import { createModule, SuccessResponseSchema, type ToolContext } from '@odel/module-sdk';
import { z } from 'zod';

// Environment bindings
interface Env {
	RESEND_API_KEY: string;
	ANALYTICS: AnalyticsEngineDataset;
}

// Input schema
const SendEmailInputSchema = z.object({
	to: z.string().email().describe('Recipient email address'),
	subject_suffix: z.string().describe('Email subject suffix (will be prefixed with "Odel has sent: ")'),
	text: z.string().describe('Plain text email body'),
	html: z.string().optional().describe('Optional HTML email body for rich formatting')
});

// Output schema
const SendEmailOutputSchema = SuccessResponseSchema(
	z.object({
		id: z.string().describe('Resend email ID for tracking'),
		to: z.string().describe('Confirmed recipient email address')
	})
);

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
 * Log email send event to Analytics Engine
 */
function logEmailSent(
	analytics: AnalyticsEngineDataset,
	trackingId: string,
	userId: string,
	conversationId: string | undefined,
	displayName: string,
	recipient: string,
	resendId: string,
	status: 'sent' | 'failed',
	textLength: number
): void {
	analytics.writeDataPoint({
		indexes: [trackingId],
		blobs: [
			userId,
			conversationId || '',  // Empty string if no conversation
			displayName,
			recipient,
			resendId,
			status
		],
		doubles: [textLength]
	});
}

// Create module
export default createModule<Env>()
	.tool({
		name: 'send_email',
		description: 'Send an email to a recipient with optional HTML formatting',
		inputSchema: SendEmailInputSchema,
		outputSchema: SendEmailOutputSchema,
		handler: async (input, context: ToolContext<Env>) => {
			try {
				// Generate tracking UUID
				const trackingId = generateUUID();

				// Build footer with user attribution
				const footer = buildFooter(
					context.userId,
					context.displayName,
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

				// Log to Analytics Engine (if available)
				if (context.env.ANALYTICS) {
					logEmailSent(
						context.env.ANALYTICS,
						trackingId,
						context.userId,
						context.conversationId,
						context.displayName,
						input.to,
						result.id,
						'sent',
						input.text.length
					);
				}

				return {
					success: true as const,
					id: result.id,
					to: input.to
				};

			} catch (error: any) {
				// Log failed attempt (if analytics available)
				if (context.env.ANALYTICS) {
					const trackingId = generateUUID();
					logEmailSent(
						context.env.ANALYTICS,
						trackingId,
						context.userId,
						context.conversationId,
						context.displayName,
						input.to,
						'',
						'failed',
						input.text.length
					);
				}

				return {
					success: false as const,
					error: `Failed to send email: ${error.message}`
				};
			}
		}
	})
	.build();
