import React from 'react'

export const SaveButton = ({ onSave, feature }) => {
    return (
        <button
            className="btn btn-primary"
            style={{
                margin: '10px',
                padding: '8px 16px',
                fontSize: '14px',
                cursor: 'pointer'
            }}
            onClick={() => onSave(feature)}
        >
            บันทึก
        </button>
    )
}
