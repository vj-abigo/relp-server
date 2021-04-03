module.exports = (server) => {
  const socketIO = require('socket.io');
  const Message = require('./model/Message.model');
  const User = require('./model/User.model');
  const Token = require('./model/Token.model');
  const { notify, UserSocketId } = require('./Utils');
  const io = socketIO(server);
  const users = new Map();
  const qrCodeMap = new Map();

  io.on('connection', (socket) => {
    console.log('Made connection id:', socket.id);

    // Add to public channel
    socket.join('anonymous');

    socket.on('authenticated', async (u) => {
      socket.leave('anonymous');
      socket.join('authenticated');

      users.set(u.uid, { id: socket.id, uid: u.uid });

      if (u) {
        io.emit('user status', {
          uid: u.uid,
          LastSeen: Date.now(),
          status: 'Online',
        });
        // Add the user status in the database
        const dbUser = await User.exists({ uid: u.uid });
        if (dbUser) {
          await User.where({ uid: u.uid }).updateOne({
            LastSeen: Date.now(),
            status: 'Online',
          });
        } else {
          const newUser = new User({
            uid: u.uid,
            LastSeen: Date.now(),
            status: 'Online',
          });
          newUser.save().then(() => console.log('Added new user'));
        }
      }

      // Search for messages in the database

      const message = await Message.find({ to: u.uid });
      console.log('Messages on the mongodb', message);
      if (message) {
        io.to(socket.id).emit('new message', message);
      }
      console.log('No of online users: ', users.size);
    });

    socket.on('send message', (message) => {
      console.log('Send message', message);
      const user = UserSocketId(users, message.to);
      console.log('the user id', user);
      if (!user) {
        const res = new Message({ ...message });
        res.save().then(() => console.log('Saved Successfully'));
        notify(message);
      } else {
        io.to(user.id).emit('recieve message', message);
        notify(message);
      }
    });

    socket.on('message recieved', async (message) => {
      await Message.deleteOne({ _id: message._id });
    });

    socket.on('fetch status', async (data) => {
      const res = await User.find({ uid: data.id });
      if (res) {
        io.to(socket.id).emit('user status disk', res);
      }
    });

    // Store notification token
    socket.on('notification token', (data) => {
      const token = new Token(data);
      token
        .save()
        .then(() => console.log('Saved Token '))
        .catch(console.error);
    });

    socket.on('Typing Indicator', (status) => {
      const user = UserSocketId(users, status.to);
      if (user) {
        io.to(user.id).emit('Typing Indicator', status);
      }
    });

    // offer -> file Transfering; callOffer -> VoiceChannel

    socket.on('offer', ({ from, to, payload }) => {
      // console.log({ to, payload });
      const user = UserSocketId(users, to);
      if (user) {
        io.to(user.id).emit('backOffer', { from, to, payload });
      }
    });

    socket.on('callOffer', ({ from, to, payload }) => {
      // console.log({ to, payload });
      const user = UserSocketId(users, to);
      io.to(user.id).emit('callBackOffer', { from, to, payload });
    });

    // answer -> file Transfering; callAnswer -> VoiceChannel

    socket.on('callAnswer', ({ from, to, payload }) => {
      // console.log({ from, to, payload });
      const user = UserSocketId(users, from);
      io.to(user.id).emit('callBackAnswer', { from, to, payload });
    });

    socket.on('answer', ({ from, to, payload }) => {
      // console.log({ from, to, payload });
      const user = UserSocketId(users, from);
      io.to(user.id).emit('backAnswer', { from, to, payload });
    });

    socket.on('shareID', ({ shareID, finalTo, channelID, ...rest }) => {
      // console.log(shareID, finalTo, rest);
      const user = UserSocketId(users, finalTo);
      io.to(user.id).emit('shareID', { shareID, channelID, rest });
    });

    socket.on('current channel', (data) => {
      const user = UserSocketId(users, data.to);
      if (user !== undefined) {
        io.to(user.id).emit('current channel', data);
      }
    });

    socket.on('created channel', ({ to }) => {
      const user = UserSocketId(users, to);
      if (user !== undefined) {
        io.to(user.id).emit('created channel');
      }
    });

    socket.on('call by', ({ from, to }) => {
      const user = UserSocketId(users, to);
      if (user !== undefined) {
        io.to(user.id).emit('call by', { from, to });
      }
    });

    socket.on('dismiss call', ({ from, to }) => {
      const user = UserSocketId(users, to.from);
      if (user !== undefined) {
        io.to(user.id).emit('dismiss call', { from, to });
      }
    });

    socket.on('join call', ({ from, to }) => {
      const user = UserSocketId(users, to.from);
      if (user !== undefined) {
        io.to(user.id).emit('join call', { from, to });
      }
    });

    socket.on('create qrcode', ({ nId, fromuID }) => {
      qrCodeMap.set(nId, {
        from: socket.id,
        fromuID,
      });
    });

    socket.on('qrcode', ({ nId, touID }) => {
      if (qrCodeMap.has(nId)) {
        const data = qrCodeMap.get(nId);
        data.to = socket.id;

        io.to(data.from).emit('qrcode connected', {
          to: socket.id,
          from: data.from,
          fromuID: data.fromuID,
          touID,
          nId,
        });
      }
    });

    socket.on('send public key', (data) => {
      if (data) {
        io.to(data.to).emit('recieve public key', data);
      }
    });

    socket.on('send other public key', (data) => {
      if (data) {
        io.to(data.from).emit('recieve other key', data);
      }
    });

    socket.on('now refresh', (data) => {
      if (data) {
        io.to(data.to).emit('now refresh');
        qrCodeMap.delete(data.nId);
      }
    });

    // Handle Clean up
    socket.on('disconnect', async () => {
      const values = users.values();

      for (const v of values) {
        if (v.id === socket.id) {
          console.log('Disconnected user id :', socket.id);
          users.delete(v.uid);
          io.emit('user status', {
            LastSeen: Date.now(),
            status: 'Offline',
            uid: v.uid,
          });

          // Update the user status in the database
          await User.where({ uid: v.uid }).updateOne({
            LastSeen: Date.now(),
            status: 'Offline',
          });
          return;
        }
      }
    });
  });
};
