import React, { useState, useEffect } from 'react'

interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number
  onChange: (value: number) => void
}

export function CurrencyInput({ value, onChange, className, ...props }: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = useState('')

  useEffect(() => {
    // Solo actualizar el displayValue si el input no está en foco para no interrumpir el typing
    // o si el valor externo cambia y es diferente al valor formateado actual
    const currentNum = parseInt(displayValue.replace(/\D/g, ''), 10) || 0
    if (value !== currentNum) {
      if (value === 0) {
        setDisplayValue('')
      } else {
        setDisplayValue(value.toLocaleString('en-US'))
      }
    }
  }, [value, displayValue])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    if (raw === '') {
      setDisplayValue('')
      onChange(0)
      return
    }
    const num = parseInt(raw, 10)
    setDisplayValue(num.toLocaleString('en-US'))
    onChange(num)
  }

  return (
    <input
      type="text"
      className={className}
      value={displayValue}
      onChange={handleChange}
      placeholder="0"
      {...props}
    />
  )
}
