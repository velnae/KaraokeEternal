import { describe, expect, it } from 'vitest'
import User from './User.js'

describe('user-facing account validation', () => {
  it('requires an account identifier and password before accessing stored users', async () => {
    await expect(User.validate({ username: '', password: 'example' }))
      .rejects.toThrow('El nombre de usuario o correo electrónico y la contraseña son obligatorios')
  })

  it('requires a username when creating a standard account', async () => {
    await expect(User.create({
      username: '',
      newPassword: 'example',
      newPasswordConfirm: 'example',
      name: 'Singer',
      image: undefined,
    })).rejects.toThrow('El nombre de usuario o correo electrónico es obligatorio')
  })

  it('rejects mismatched passwords before creating an account', async () => {
    await expect(User.create({
      username: 'singer',
      newPassword: 'example',
      newPasswordConfirm: 'different',
      name: 'Singer',
      image: undefined,
    })).rejects.toThrow('Las contraseñas nuevas no coinciden')
  })
})
