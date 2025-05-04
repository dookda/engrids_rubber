const express = require('express')
const app = express()
const cors = require('cors')
app.use(cors());

app.use('/rub', require('./service/api'));
app.use('/rub', require('./service/authen'));
app.use('/rub', express.static('www'));

const port = 3000;
app.listen(port, () => {
    console.log(`http://localhost:${port}`)
});