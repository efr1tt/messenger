import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Socket } from 'node:net';
import { TLSSocket, connect as tlsConnect } from 'node:tls';

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
};

type MailDeliveryResult = {
  previewOnly: boolean;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

@Injectable()
export class SmtpMailerService {
  async sendTemporaryPasswordEmail(input: {
    to: string;
    displayName: string;
    temporaryPassword: string;
  }): Promise<MailDeliveryResult> {
    const config = this.getConfig();
    const subject = 'SweetyCall temporary password';
    const text = [
      `Hello, ${input.displayName}.`,
      '',
      'You requested a new password for your SweetyCall account.',
      `Temporary password: ${input.temporaryPassword}`,
      '',
      'Use this password to sign in and then change it from your profile settings.',
      'If you did not request this, you can ignore this email.',
    ].join('\n');

    if (!config) {
      if (process.env.NODE_ENV === 'production') {
        throw new InternalServerErrorException(
          'Password recovery email is not configured',
        );
      }

      console.info(
        `[auth:forgot-password] SMTP is not configured. Temporary password for ${input.to}: ${input.temporaryPassword}`,
      );

      return { previewOnly: true };
    }

    await this.sendMail(config, {
      to: input.to,
      subject,
      text,
    });

    return { previewOnly: false };
  }

  private getConfig(): SmtpConfig | null {
    const host = process.env.SMTP_HOST?.trim();
    const port = Number.parseInt(process.env.SMTP_PORT || '', 10);
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    const from = process.env.SMTP_FROM?.trim();
    const secure = (process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';

    if (!host || !port || !user || !pass || !from) {
      return null;
    }

    return {
      host,
      port,
      secure,
      user,
      pass,
      from,
    };
  }

  private async sendMail(config: SmtpConfig, input: SendMailInput) {
    let socket = await this.openSocket(config);
    let reader = this.createResponseReader(socket);

    try {
      await reader.read();

      let ehloResponse = await this.sendCommand(
        socket,
        reader,
        `EHLO ${this.getEhloName()}`,
      );

      if (!config.secure && ehloResponse.some((line) => /STARTTLS/i.test(line))) {
        await this.sendCommand(socket, reader, 'STARTTLS');
        socket = await this.upgradeToTls(socket, config.host);
        reader = this.createResponseReader(socket);
        ehloResponse = await this.sendCommand(
          socket,
          reader,
          `EHLO ${this.getEhloName()}`,
        );
      }

      if (ehloResponse.some((line) => /AUTH(?:\s|=).*PLAIN/i.test(line))) {
        const authPlain = Buffer.from(
          `\u0000${config.user}\u0000${config.pass}`,
          'utf8',
        ).toString('base64');
        await this.sendCommand(socket, reader, `AUTH PLAIN ${authPlain}`);
      } else if (ehloResponse.some((line) => /AUTH(?:\s|=).*LOGIN/i.test(line))) {
        await this.sendCommand(socket, reader, 'AUTH LOGIN', 334);
        await this.sendCommand(
          socket,
          reader,
          Buffer.from(config.user, 'utf8').toString('base64'),
          334,
        );
        await this.sendCommand(
          socket,
          reader,
          Buffer.from(config.pass, 'utf8').toString('base64'),
        );
      } else {
        throw new InternalServerErrorException(
          'SMTP server does not support supported auth methods',
        );
      }

      await this.sendCommand(socket, reader, `MAIL FROM:<${config.from}>`);
      await this.sendCommand(socket, reader, `RCPT TO:<${input.to}>`);
      await this.sendCommand(socket, reader, 'DATA', 354);

      const message = this.buildMessage(config.from, input);
      await this.write(socket, `${message}\r\n.\r\n`);
      await reader.read(250);
      await this.sendCommand(socket, reader, 'QUIT', 221);
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to send password recovery email',
      );
    } finally {
      socket.destroy();
    }
  }

  private buildMessage(from: string, input: SendMailInput) {
    const escapedText = input.text
      .replace(/\r?\n/g, '\r\n')
      .replace(/^\./gm, '..');

    return [
      `From: SweetyCall <${from}>`,
      `To: <${input.to}>`,
      `Subject: ${input.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      escapedText,
    ].join('\r\n');
  }

  private getEhloName() {
    return process.env.SMTP_EHLO_NAME?.trim() || 'localhost';
  }

  private openSocket(config: SmtpConfig) {
    return new Promise<Socket | TLSSocket>((resolve, reject) => {
      const onError = (error: Error) => reject(error);

      if (config.secure) {
        const socket = tlsConnect(
          {
            host: config.host,
            port: config.port,
            servername: config.host,
          },
          () => resolve(socket),
        );

        socket.once('error', onError);
        return;
      }

      const socket = new Socket();
      socket.once('error', onError);
      socket.connect(config.port, config.host, () => resolve(socket));
    });
  }

  private upgradeToTls(socket: Socket | TLSSocket, host: string) {
    return new Promise<TLSSocket>((resolve, reject) => {
      const secureSocket = tlsConnect(
        {
          socket,
          servername: host,
        },
        () => resolve(secureSocket),
      );

      secureSocket.once('error', reject);
    });
  }

  private createResponseReader(socket: Socket | TLSSocket) {
    let buffer = '';
    const queue: string[] = [];
    let resolvePending: (() => void) | null = null;

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;

      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        queue.push(line);
      }

      if (resolvePending) {
        const next = resolvePending;
        resolvePending = null;
        next();
      }
    });

    const waitForLine = async () => {
      if (queue.length > 0) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        resolvePending = resolve;
        socket.once('error', reject);
        socket.once('close', () => reject(new Error('SMTP socket closed')));
      });
    };

    return {
      read: async (expectedCode?: number) => {
        const lines: string[] = [];

        while (true) {
          await waitForLine();
          const line = queue.shift();
          if (!line) {
            continue;
          }

          lines.push(line);
          if (/^\d{3} /.test(line)) {
            const code = Number.parseInt(line.slice(0, 3), 10);
            if (expectedCode && code !== expectedCode) {
              throw new Error(`Unexpected SMTP response: ${line}`);
            }
            if (!expectedCode && code >= 400) {
              throw new Error(`SMTP error: ${line}`);
            }
            return lines;
          }
        }
      },
    };
  }

  private async sendCommand(
    socket: Socket | TLSSocket,
    reader: { read: (expectedCode?: number) => Promise<string[]> },
    command: string,
    expectedCode?: number,
  ) {
    await this.write(socket, `${command}\r\n`);
    return reader.read(expectedCode);
  }

  private write(socket: Socket | TLSSocket, value: string) {
    return new Promise<void>((resolve, reject) => {
      socket.write(value, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
