import React from 'react'

export const InputPosition = ({ type, name, value, onChange }) => {
    return (
        <input className='form-control mt-2'
            type={type}
            name={name}
            value={value}
            onChange={onChange} />
    )
}
