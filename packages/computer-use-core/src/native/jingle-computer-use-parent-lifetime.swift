import Darwin
import Foundation

enum JingleParentLifetimeError: Error {
    case parentUnavailable
    case registrationFailed
}

final class JingleParentLifetimeGuard {
    private let expectedParentPid: pid_t
    private let queueDescriptor: Int32

    init(environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        guard let rawParentPid = environment["JINGLE_PARENT_PID"],
              let parsedParentPid = Int32(rawParentPid),
              parsedParentPid > 1,
              getppid() == parsedParentPid else {
            throw JingleParentLifetimeError.parentUnavailable
        }

        let descriptor = kqueue()
        guard descriptor >= 0 else {
            throw JingleParentLifetimeError.registrationFailed
        }

        var registration = kevent(
            ident: UInt(parsedParentPid),
            filter: Int16(EVFILT_PROC),
            flags: UInt16(EV_ADD | EV_ENABLE | EV_ONESHOT),
            fflags: UInt32(NOTE_EXIT),
            data: 0,
            udata: nil
        )
        guard kevent(descriptor, &registration, 1, nil, 0, nil) == 0 else {
            close(descriptor)
            throw JingleParentLifetimeError.registrationFailed
        }

        // Register before the second identity check so a parent exit between
        // the first check and kqueue registration cannot be missed.
        guard getppid() == parsedParentPid,
              kill(parsedParentPid, 0) == 0 || errno != ESRCH else {
            close(descriptor)
            throw JingleParentLifetimeError.parentUnavailable
        }

        expectedParentPid = parsedParentPid
        queueDescriptor = descriptor
        startExitMonitor(descriptor: descriptor)
    }

    deinit {
        close(queueDescriptor)
    }

    func assertAlive() throws {
        guard getppid() == expectedParentPid,
              kill(expectedParentPid, 0) == 0 || errno != ESRCH else {
            throw JingleParentLifetimeError.parentUnavailable
        }
    }

    private func startExitMonitor(descriptor: Int32) {
        DispatchQueue.global(qos: .userInitiated).async {
            var event = kevent()
            let result = kevent(descriptor, nil, 0, &event, 1, nil)
            // The helper must fail closed if its parent exits or if the
            // lifecycle monitor itself becomes unusable.
            if result > 0 || (result < 0 && errno != EBADF) {
                _exit(125)
            }
        }
    }
}
