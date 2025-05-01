import React, { use, useEffect, useState } from 'react'

export const SelectType = ({ value, onChangeType }) => {
    const [selectedType, setSelectedType] = useState('rubber')
    const handleTypeChange = (event) => {
        const type = event.target.value
        setSelectedType(type)
        onChangeType(type)
    }

    useEffect(() => {
        setSelectedType(value)
    }, [value])

    return (
        <div>
            <h5>เลือกประเภท</h5>
            <div className="form-group">
                <label htmlFor="type">ประเภท</label>
                <select className="form-select"
                    value={value} onChange={handleTypeChange} >
                    <option value="rubber">ยางพารา</option>
                    <option value="etc">อื่นๆ</option>
                </select>
            </div>
            <button className="btn btn-primary mt-2">บันทึก</button>
        </div>
    )
}
