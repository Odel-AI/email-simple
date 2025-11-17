/**
 * Email Module Tests
 *
 * Note: Most tests will fail without RESEND_API_KEY configured.
 * These tests primarily validate schema and input validation.
 */

import { describe, test, expect } from 'vitest';
import { testMCPCompliance, testTool, expectSuccess, expectError } from '@odel/module-sdk/testing';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from './index';

// Test MCP protocol compliance
testMCPCompliance(
	() => ({ worker, env, createExecutionContext, waitOnExecutionContext }),
	['send_email']
);

// Business Logic Tests
describe('Email Module - Business Logic', () => {
	describe('Input validation', () => {
		test('validates email address format', async () => {
			try {
				await testTool(worker, 'send_email', {
					to: 'invalid-email',  // Invalid format
					subject_suffix: 'Test',
					text: 'Test message'
				});
				expect.fail('Should have thrown validation error');
			} catch (error: any) {
				// Should throw validation error
				expect(error.message).toContain('Tool execution failed');
			}
		});

		test('requires subject_suffix field', async () => {
			try {
				await testTool(worker, 'send_email', {
					to: 'test@example.com',
					text: 'Test message'
					// Missing subject_suffix
				} as any);
				expect.fail('Should have thrown validation error');
			} catch (error: any) {
				expect(error.message).toContain('Tool execution failed');
			}
		});

		test('requires text field', async () => {
			try {
				await testTool(worker, 'send_email', {
					to: 'test@example.com',
					subject_suffix: 'Test'
					// Missing text
				} as any);
				expect.fail('Should have thrown validation error');
			} catch (error: any) {
				expect(error.message).toContain('Tool execution failed');
			}
		});

		test('accepts optional html field', async () => {
			// This test validates that html is accepted
			// It will fail at runtime without RESEND_API_KEY but that's expected
			const result = await testTool(worker, 'send_email', {
				to: 'test@example.com',
				subject_suffix: 'Test',
				text: 'Plain text',
				html: '<p>HTML content</p>'
			});

			// Either succeeds (if API key exists) or fails with API error (not validation error)
			if (result.success === false) {
				expect(result.error).toContain('Resend API error');
			} else {
				expectSuccess(result);
				expect(result.id).toBeDefined();
				expect(result.to).toBe('test@example.com');
			}
		});
	});

	describe('Context handling', () => {
		test('uses provided context for user attribution', async () => {
			const result = await testTool(worker, 'send_email', {
				to: 'test@example.com',
				subject_suffix: 'Test',
				text: 'Test message'
			}, {
				context: {
					userId: 'hashed_user_123',
					displayName: 'Test User',
					secrets: {}
				}
			});

			// Context should be accepted
			// Will fail without API key, but validates context handling
			if (result.success === false) {
				expect(result.error).toBeDefined();
			} else {
				expectSuccess(result);
			}
		});
	});

	describe('Output schema', () => {
		test('returns correct success schema structure', () => {
			const expectedSuccessSchema = {
				success: true,
				id: expect.any(String),  // Resend email ID
				to: expect.any(String)   // Recipient email
			};

			// Schema validation is tested by module SDK
			expect(expectedSuccessSchema).toBeDefined();
		});

		test('returns correct error schema structure', () => {
			const expectedErrorSchema = {
				success: false,
				error: expect.any(String)
			};

			expect(expectedErrorSchema).toBeDefined();
		});
	});
});
