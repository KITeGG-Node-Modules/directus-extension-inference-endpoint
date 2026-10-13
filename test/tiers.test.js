import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, limitsFor, tierFor } from '../src/lib/tiers.js'

describe('tierFor', () => {
  it('maps Directus role names to tiers', () => {
    expect(tierFor('HS Trier / Student')).toBe('student')
    expect(tierFor('External / Staff')).toBe('staff')
    expect(tierFor('HS Mainz / Management')).toBe('admin')
    expect(tierFor('Administrator')).toBe('admin')
  })
  it('treats the admin flag as admin whatever the role', () => {
    expect(tierFor('HS Trier / Student', true)).toBe('admin')
  })
  it('falls back to the lowest tier for unknown or missing roles', () => {
    expect(tierFor(undefined)).toBe('student')
    expect(tierFor('Something new')).toBe('student')
  })
})

describe('limitsFor', () => {
  it('gives staff more than students and admins none', () => {
    expect(DEFAULT_LIMITS.staff.rpm_limit).toBeGreaterThan(
      DEFAULT_LIMITS.student.rpm_limit
    )
    expect(limitsFor('admin')).toEqual({})
  })
  it('merges a JSON override per tier and ignores broken JSON', () => {
    expect(limitsFor('student', '{"student":{"rpm_limit":5}}').rpm_limit).toBe(
      5
    )
    expect(limitsFor('student', '{nope')).toEqual(DEFAULT_LIMITS.student)
  })
})
