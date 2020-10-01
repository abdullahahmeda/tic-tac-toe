const app = require('express')();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const morgan = require('morgan');

app.use( require('express').static( path.join(__dirname, 'public')) );
app.use(morgan(':method :url :status [:res[content-length]] - :response-time ms'));

const routes = require('./routes/route');

app.response.relativeSendFile = function(filePath, options, fn) {
    return this.sendFile.apply(this, [ path.join(__dirname, filePath), options, fn ])
}

app.use('/', routes)

const PORT = process.env.PORT || 5000;

server.listen(PORT, function() {
    console.log(`Server is running at port ${PORT}`);
})