import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/middleware/validate';

function mockReqResNext(body: any) {
  const req = { body } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('validate middleware', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().min(0),
  });

  it('passes valid data to next()', () => {
    const { req, res, next } = mockReqResNext({ name: 'Ali', age: 25 });
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Ali', age: 25 });
  });

  it('returns 400 for invalid data', () => {
    const { req, res, next } = mockReqResNext({ name: '', age: -1 });
    validate(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });

  it('returns field-level error details', () => {
    const { req, res, next } = mockReqResNext({ age: 'not-a-number' });
    validate(schema)(req, res, next);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.details).toBeDefined();
    expect(jsonCall.details.length).toBeGreaterThan(0);
    expect(jsonCall.details[0]).toHaveProperty('field');
    expect(jsonCall.details[0]).toHaveProperty('message');
  });
});
