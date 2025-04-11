const express = require('express')
const app = express()

app.use('/rub', require('./service/api'));
app.use('/rub', express.static('www'));

const port = 3000;
app.listen(port, () => {
    console.log(`http://localhost:${port}`)
});