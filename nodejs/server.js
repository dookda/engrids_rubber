const express = require('express')
const app = express()

app.use(require('./service/api'));
app.use('/', express.static('www'));

const port = 3000;
app.listen(port, () => {
    console.log(`http://localhost:${port}`)
});